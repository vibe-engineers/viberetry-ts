import type { JevEvaluator } from "@vibe-engineers/vibetools/_internal/jev_evaluator"
import { readProperty } from "@vibe-engineers/vibetools/_internal/prompt"
import {
  isPlainObject,
  validateProbabilityThreshold,
  VibeConfig,
  type VibeConfigOptions,
} from "@vibe-engineers/vibetools/_internal/vibe_config"
import type { VibeLlmClient } from "@vibe-engineers/vibetools/_internal/vibe_llm_client"
import type { VibeBaseLlm } from "@vibe-engineers/vibetools/llms/vibe_base_llm"
import { VibeRetryConfig } from "./config/config.js"
import { RetryResult } from "./models/models.js"
import { failureContext, failurePrompt, type HistoricalAttempt } from "./utils/prompt.js"

/** Per-operation retry budget, guidance, and Jev cutoff. */
export interface RetryOptions {
  max_retries?: number
  remarks?: string
  /** Jev retries at or above this cutoff in [0, 1]. Null and undefined use 0.7. */
  probability_threshold?: number | null | undefined
}

type CommonRetryOptions = Omit<RetryOptions, "probability_threshold">
// An optional cutoff on a shared options object is checked at runtime.
// A required numeric cutoff needs a known Jev evaluator.
type RetryOptionsFor<Evaluator, Options extends RetryOptions> =
  | (CommonRetryOptions & { probability_threshold?: null | undefined })
  | (Options &
      Record<Exclude<keyof Options, keyof RetryOptions>, never> &
      (Options extends { probability_threshold: number } ? never : unknown))
  | ([Evaluator] extends [JevEvaluator] ? RetryOptions : never)

type Operation<This, Args extends unknown[], R> = (this: This, ...args: Args) => R
type Wrapped<This, Args extends unknown[], R> = Operation<This, Args, Promise<Awaited<R>>>
type MethodContext = Pick<ClassMethodDecoratorContext, "kind" | "addInitializer">

export interface RetryWrapper {
  <This, Args extends unknown[], R>(
    operation: Operation<This, Args, R>,
    context?: undefined,
  ): Wrapped<This, Args, R>
  <This, Args extends unknown[], R>(
    operation: Operation<This, Args, Promise<R>>,
    context: MethodContext,
  ): Wrapped<This, Args, R>
}

/** The configured retry decorator wraps a function or decorates a promise-returning method. */
export interface VibeRetryDecorator<Evaluator = VibeLlmClient> {
  <This, Args extends unknown[], R, Options extends RetryOptions = CommonRetryOptions>(
    operation: Operation<This, Args, R>,
    options?: RetryOptionsFor<Evaluator, Options>,
  ): Wrapped<This, Args, R>
  <This, Args extends unknown[], R>(
    operation: Operation<This, Args, Promise<R>>,
    context: MethodContext,
  ): Wrapped<This, Args, R>
  <Options extends RetryOptions>(
    options?: RetryOptionsFor<Evaluator, Options>,
    context?: undefined,
  ): RetryWrapper
  llm: Evaluator
}

function retryOptions(options: RetryOptions = {}) {
  if (!isPlainObject(options)) throw new TypeError("Retry options must be a plain object.")
  for (const key of Object.keys(options)) {
    if (!["max_retries", "remarks", "probability_threshold"].includes(key)) {
      throw new TypeError(`Unexpected retry option: ${key}`)
    }
  }
  const { max_retries = 1, remarks = "", probability_threshold = null }: RetryOptions = options
  if (typeof max_retries !== "number" || !Number.isSafeInteger(max_retries)) {
    throw new RangeError("max_retries must be a safe integer.")
  }
  if (typeof remarks !== "string") throw new TypeError("remarks must be a string.")
  const threshold =
    probability_threshold === null ? null : validateProbabilityThreshold(probability_threshold)
  return { max_retries, remarks, threshold }
}

async function waitForRetry(seconds: number): Promise<void> {
  // Browser and Node timers accept at most 2^31 - 1 milliseconds at a time.
  const maxSecondsPerTimer = Math.floor(2_147_483_647 / 1000)
  while (seconds > 0) {
    const chunk = Math.min(seconds, maxSecondsPerTimer)
    await new Promise<void>((resolve) => setTimeout(resolve, chunk * 1000))
    seconds -= chunk
  }
}

export type Config = VibeConfig | VibeConfigOptions | null
type Evaluator = VibeBaseLlm | JevEvaluator

export function retryConfig(config?: Config): VibeConfig {
  return config instanceof VibeConfig ? config : new VibeRetryConfig(config ?? {})
}

/** Node supplies its Jev evaluator class so replacements can change the decision provider. */
export function createRetryDecorator<E extends Evaluator>(
  initialEvaluator: E,
  jevClass?: typeof JevEvaluator,
): VibeRetryDecorator<E> {
  function isJev(evaluator: Evaluator): evaluator is JevEvaluator {
    return jevClass !== undefined && evaluator instanceof jevClass
  }

  async function retryDecision(
    evaluator: Evaluator,
    context: ReturnType<typeof failureContext>,
    history: HistoricalAttempt[],
    remarks: string,
    threshold: number | null,
  ): Promise<RetryResult> {
    if (isJev(evaluator)) {
      const p = await evaluator.probability({ ...context, historical_attempts: history, remarks })
      return { should_retry: p >= (threshold ?? 0.7), delay: Math.min(30, 2 ** history.length) }
    }
    return evaluator.vibe_eval(failurePrompt(context, history, remarks), RetryResult)
  }

  function currentEvaluator(threshold: number | null): Evaluator {
    const evaluator = retry.llm
    if (threshold !== null && !isJev(evaluator)) {
      throw new TypeError("probability_threshold requires a Jev TypeSafeClient.")
    }
    return evaluator
  }

  function withOptions(options?: RetryOptions): RetryWrapper {
    const { max_retries, remarks, threshold } = retryOptions(options)
    if (threshold !== null) currentEvaluator(threshold)
    return function wrap<This, Args extends unknown[], R>(
      operation: Operation<This, Args, R>,
      context?: MethodContext,
    ): Wrapped<This, Args, R> {
      if (typeof operation !== "function" || (context && context.kind !== "method")) {
        throw new TypeError("VibeRetry wraps functions and decorates methods.")
      }
      const originalName = readProperty(operation, "name")
      const name = typeof originalName === "string" ? originalName : ""
      const length = readProperty(operation, "length")
      async function wrapped(this: This, ...args: Args): Promise<Awaited<R>> {
        const history: HistoricalAttempt[] = []
        for (;;) {
          // The caller can replace llm after configuring the wrapper or between attempts.
          if (threshold !== null) currentEvaluator(threshold)
          try {
            return await Reflect.apply(operation, this, args)
          } catch (error) {
            if (history.length >= max_retries) throw error
            const context = failureContext(name, args, error)
            const decision = await retryDecision(
              currentEvaluator(threshold),
              context,
              history,
              remarks,
              threshold,
            )
            if (!decision.should_retry) throw error
            const { delay } = decision
            history.push({ attempt: history.length + 1, delay })
            if (delay > 0) await waitForRetry(delay)
          }
        }
      }
      Object.defineProperties(wrapped, {
        name: { value: name, configurable: true },
        length: { value: typeof length === "number" ? length : 0, configurable: true },
      })
      return wrapped
    }
  }

  function retry<This, Args extends unknown[], R>(
    arg?: Operation<This, Args, R> | RetryOptions,
    second?: RetryOptions | MethodContext,
  ) {
    if (second && typeof second === "object" && "addInitializer" in second && "kind" in second) {
      if (
        typeof arg !== "function" ||
        typeof second.addInitializer !== "function" ||
        second.kind !== "method"
      ) {
        throw new TypeError("VibeRetry decorates methods.")
      }
      return withOptions()(arg)
    }
    if (typeof arg === "function") return withOptions(second)(arg)
    if (second !== undefined) throw new TypeError("Expected a function before the retry options.")
    return withOptions(arg)
  }
  retry.llm = initialEvaluator
  return retry as VibeRetryDecorator<E>
}
