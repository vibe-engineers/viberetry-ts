import type { GoogleGenAI } from "@google/genai"
import type { TypeSafeClient } from "@typesafe-ai/sdk"
import { type RetryOptions, VibeRetry, type VibeRetryDecorator } from "@vibe-engineers/viberetry"
import { VibeRetryConfig } from "@vibe-engineers/viberetry/config/config"
import { RetryResult } from "@vibe-engineers/viberetry/models/models"
import type {
  DecisionClientResult,
  JevClient,
  JevEvaluator,
  SharedClient,
  VibeLlmClient,
} from "@vibe-engineers/vibetools/_internal"
import type { WebLlmEngine } from "@vibe-engineers/vibetools/llms/webllm_wrapper"
import type OpenAI from "openai"

declare const openai: OpenAI
declare const gemini: GoogleGenAI
declare const jev: TypeSafeClient
declare function expectType<T>(value: T): void

export const retry = VibeRetry(openai, "model")
export function genericRetry<C extends JevClient | SharedClient>(
  client: C,
): VibeRetryDecorator<DecisionClientResult<C, JevEvaluator, VibeLlmClient>> {
  return VibeRetry(client, "model")
}
retry.llm = VibeRetry(gemini, "model", { vibe_mode: "eager" }).llm
VibeRetry(openai, "model", new VibeRetryConfig())
VibeRetry(openai, "model", null)
const checkResult: RetryResult = await retry.llm.vibe_eval("decision", RetryResult)
declare const fromExistingWrapper: ReturnType<typeof VibeRetry>
expectType<Promise<RetryResult>>(fromExistingWrapper.llm.vibe_eval("decision", RetryResult))
declare const mixed: TypeSafeClient | OpenAI
expectType<Promise<number>>(VibeRetry(mixed, "model")(() => 4)())
declare const localOrJev: WebLlmEngine | TypeSafeClient
const mixedRetry = VibeRetry(localOrJev, "model")
expectType<Promise<number>>(mixedRetry(() => 4)())
// @ts-expect-error A numeric cutoff needs a known Jev client.
mixedRetry({ probability_threshold: 0.5 })
if ("getGPUVendor" in localOrJev) {
  expectType<Promise<string>>(VibeRetry(localOrJev, "model").llm.client.getGPUVendor())
} else {
  VibeRetry(localOrJev, "model")({ probability_threshold: 0.5 })
}
declare const extendedOpenAI: OpenAI & WebLlmEngine
// A hosted SDK can also expose the structural local-engine interface.
expectType<typeof retry.llm>(VibeRetry(extendedOpenAI, "model").llm)
declare const untypedClient: ReturnType<typeof JSON.parse>
expectType<Promise<RetryResult>>(
  VibeRetry(untypedClient, "model").llm.vibe_eval("decision", RetryResult),
)
export const alternateRetryFactory = VibeRetry
export const retryFactories = { retry: VibeRetry }
expectType<number>(checkResult.delay)
expectType<boolean>(checkResult.should_retry)
const format = (id: number, suffix = "", ...rest: string[]) => id + suffix + rest.join("")
export const configuredRetry = retry({ max_retries: 2 })
export const wrapped = retry(format)
expectType<Promise<string>>(wrapped(3))
expectType<Promise<string>>(retry()(format)(4, "x", "y"))
expectType<Promise<string>>(retry(format, { max_retries: 0 })(5))
expectType<Promise<string>>(retry({ remarks: "check id" })(format)(6))
const jevRetry = VibeRetry(jev, "jev-model")
declare const sharedOptions: RetryOptions
expectType<Promise<string>>(retry(format, sharedOptions)(3))
expectType<Promise<string>>(jevRetry(format, sharedOptions)(3))
function wrapWithOptions<T extends RetryOptions>(options: T) {
  return retry(format, options)
}
function configureRetry<T extends NonNullable<Parameters<typeof retry>[0]>>(options: T) {
  return retry(options)
}
expectType<Promise<string>>(wrapWithOptions(sharedOptions)(3))
expectType<Promise<string>>(configureRetry(sharedOptions)(format)(3))
const wrapNumber = retry<unknown, [number], string>
expectType<Promise<string>>(wrapNumber(format, sharedOptions)(3))
// @ts-expect-error The OpenAI wrapper also rejects a numeric cutoff with explicit type arguments.
wrapNumber(format, { probability_threshold: 0.5 })
const customCutoff = { probability_threshold: 0.55, max_retries: 1 } satisfies RetryOptions
export const configuredJevRetry = jevRetry(customCutoff)
expectType<Promise<string>>(configuredJevRetry(format)(3))
expectType<Promise<string>>(jevRetry(format, customCutoff)(3))
// @ts-expect-error Narrow a union client to Jev before setting a numeric threshold.
VibeRetry(mixed, "model")(format, customCutoff)
if ("systemOne" in mixed) {
  expectType<Promise<string>>(VibeRetry(mixed, "model")(format, customCutoff)(3))
}
expectType<Promise<string>>(retry(format, { probability_threshold: null })(3))
expectType<Promise<string>>(retry({ probability_threshold: undefined })(format)(3))
// @ts-expect-error OpenAI's boolean retry decision has no probability.
retry(format, customCutoff)
// @ts-expect-error Gemini's boolean retry decision has no probability.
VibeRetry(gemini, "model")({ probability_threshold: 0.7 })
// @ts-expect-error Jev thresholds are numeric.
jevRetry({ probability_threshold: "0.5" })
class JevService {
  @jevRetry({ probability_threshold: 0.55 })
  async load(id: number) {
    return id
  }
}
expectType<Promise<number>>(new JevService().load(2))
expectType<Promise<void>>(retry(async () => {})())
function keep<T>(item: T) {
  return item
}
const identity = retry(keep)
expectType<Promise<number>>(identity(12))
const owner = { mult: 2 }
function product(this: typeof owner, n: number) {
  return this.mult * n
}
expectType<Promise<number>>(retry(product).call(owner, 4))

class Store {
  @retry
  async read(id: number) {
    return id.toString()
  }
  @retry({ max_retries: 2 })
  static async valid(id: string) {
    return id.length > 0
  }
  @retry()
  async detached(this: void, count: number) {
    return count
  }
  // @ts-expect-error A decorated method must declare its asynchronous result.
  @retry
  sync() {
    return "sync"
  }
  // @ts-expect-error The configured decorator also requires an asynchronous method.
  @retry({ remarks: "a hint" })
  otherSync() {
    return 4
  }
  // @ts-expect-error A configured decorator must also reject synchronous void methods.
  @retry()
  syncVoid(): void {}
  // @ts-expect-error An async function stored in a field is not a method.
  @retry
  handler = async (id: number) => id
  // @ts-expect-error Configured decorators also require a method.
  @retry({ max_retries: 2 })
  configuredHandler = async (id: number) => id
}
expectType<Promise<string>>(new Store().read(1))
expectType<Promise<boolean>>(Store.valid("id"))
const detached = new Store().detached
expectType<Promise<number>>(detached(1))
// @ts-expect-error The wrapped result must be awaited.
expectType<string>(wrapped(3))
// @ts-expect-error Wrapping preserves the original parameter type.
wrapped("3")
// @ts-expect-error A receiver is required.
retry(product)(4)
// @ts-expect-error Invalid retry budget.
retry({ max_retries: "2" })
// @ts-expect-error Retry counts belong on the wrapper call.
VibeRetry(openai, "model", { max_retries: 2 })
// @ts-expect-error Call the factory without new.
new VibeRetry(openai, "model")
