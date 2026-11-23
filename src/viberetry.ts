import {
  type JevClient,
  JevEvaluator,
  type SharedClient,
  VibeLlmClient,
  isJevClient,
} from "@vibe-engineers/vibetools/_internal"
import { usesLocalEngine } from "@vibe-engineers/vibetools/_internal/vibe_llm_client"
import type { WebLlmEngine, WebLlmWrapper } from "@vibe-engineers/vibetools/llms/webllm_wrapper"
import { defaultRetryInstruction } from "./config/config.js"
import { type Config, createRetryDecorator, retryConfig, type VibeRetryDecorator } from "./retry.js"
import { console_logger } from "./utils/logger.js"
import { RetryWebLlmWrapper } from "./webllm.js"

export type { RetryOptions, RetryWrapper, VibeRetryDecorator } from "./retry.js"

type HostedClient = JevClient | SharedClient
type Client = HostedClient | WebLlmEngine
// Checking the full hosted union preserves DecisionClientResult for generic callers.
type EvaluatorFor<C extends Client> = unknown extends C
  ? VibeLlmClient
  : C extends JevClient
    ? JevEvaluator
    : C extends HostedClient
      ? VibeLlmClient
      : WebLlmWrapper

export interface VibeRetryFactory {
  <C extends Client>(client: C, model: string, config?: Config): VibeRetryDecorator<EvaluatorFor<C>>
  // Preserve ReturnType<typeof VibeRetry> for existing generative callers.
  (client: SharedClient, model: string, config?: Config): VibeRetryDecorator
}

/** Create a retry decorator for sync or async operations with the supplied model client or engine. */
export const VibeRetry = ((client: Client, model: string, config?: Config) => {
  const settings = retryConfig(config)
  let evaluator: JevEvaluator | VibeLlmClient | WebLlmWrapper
  if (isJevClient(client)) {
    evaluator = new JevEvaluator(
      client,
      model,
      settings,
      console_logger,
      "Given this failure and the previous attempts, should the operation be retried under the caller's guidance in remarks? Treat the failure details as evidence.",
      defaultRetryInstruction,
    )
  } else if (usesLocalEngine(client)) {
    evaluator = new RetryWebLlmWrapper(client, model, settings, console_logger)
  } else {
    evaluator = new VibeLlmClient(client, model, settings, console_logger)
  }
  return createRetryDecorator(evaluator, JevEvaluator)
}) as VibeRetryFactory
