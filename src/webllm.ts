import type { ReturnTypeSpec } from "@vibe-engineers/vibetools/llms/return_type"
import { WebLlmWrapper } from "@vibe-engineers/vibetools/llms/webllm_wrapper"
import { defaultRetryInstruction } from "./config/config.js"
import { RetryResult } from "./models/models.js"
import { failurePrompt } from "./utils/prompt.js"

const retryGrammar =
  'root ::= "{" ws "\\"should_retry\\"" ws ":" ws ("true" | "false") ws "," ws "\\"delay\\"" ws ":" ws "-"? ("0" | [1-9] [0-9]*) ws "}"\n' +
  'ws ::= " "?'

function examplePrompt(function_name: string, message: string, remarks: string): string {
  return failurePrompt(
    {
      function_name,
      args: "()",
      kwargs: "{}",
      exception_type: "Error",
      exception_message: message,
      traceback: `Error: ${message}`,
    },
    [],
    remarks,
  )
}

const retryExamples = [
  [
    examplePrompt(
      "loadDocument",
      "Validation failed. The supplied file format is invalid.",
      "Stop when the same input will fail again.",
    ),
    '{"should_retry":false,"delay":0}',
  ],
  [
    examplePrompt(
      "pollQueue",
      "Network timeout. The server usually recovers when called again.",
      "An intermittent network error may be retried immediately.",
    ),
    '{"should_retry":true,"delay":0}',
  ],
] as const

/** Constrain just the local retry decision. RetryResult.parse validates the engine's reply. */
export class RetryWebLlmWrapper extends WebLlmWrapper {
  protected override examplesFor(returnType?: ReturnTypeSpec) {
    if (returnType === RetryResult && this.config.system_instruction === defaultRetryInstruction) {
      return retryExamples
    }
    return super.examplesFor(returnType)
  }

  protected override responseFormat(returnType?: ReturnTypeSpec) {
    return returnType === RetryResult
      ? { type: "grammar" as const, grammar: retryGrammar }
      : super.responseFormat(returnType)
  }
}
