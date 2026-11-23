import { VibeLlmClientException } from "@vibe-engineers/vibetools"
import {
  type WebLlmEngine,
  type WebLlmWrapper,
  isWebLlmEngine,
} from "@vibe-engineers/vibetools/llms/webllm_wrapper"
import {
  type Config,
  createRetryDecorator,
  retryConfig,
  type VibeRetryDecorator as RetryDecorator,
} from "./retry.js"
import { console_logger } from "./utils/logger.js"
import { RetryWebLlmWrapper } from "./webllm.js"

export type { RetryOptions, RetryWrapper } from "./retry.js"
export interface VibeRetryDecorator<Evaluator = WebLlmWrapper> extends RetryDecorator<Evaluator> {}
export interface VibeRetryFactory {
  // biome-ignore lint/style/useShorthandFunctionType: Consumers can augment the public factory interface.
  <Engine extends WebLlmEngine>(engine: Engine, model: string, config?: Config): VibeRetryDecorator
}

/** Wrap an operation using the WebLLM engine initialized by the browser application. */
export const VibeRetry: VibeRetryFactory = (engine, model, config) => {
  const settings = retryConfig(config)
  if (!isWebLlmEngine(engine)) {
    throw new VibeLlmClientException("A browser VibeRetry requires a WebLLM engine.")
  }
  return createRetryDecorator(new RetryWebLlmWrapper(engine, model, settings, console_logger))
}
