import type { CreateMLCEngine, CreateWebWorkerMLCEngine } from "@mlc-ai/web-llm"
import { type RetryOptions, VibeRetry } from "@vibe-engineers/viberetry"
import { VibeRetryConfig } from "@vibe-engineers/viberetry/config/config"
import { RetryResult } from "@vibe-engineers/viberetry/models/models"
import { VibeRetry as fromSubpath } from "@vibe-engineers/viberetry/viberetry"

declare const engine: Awaited<ReturnType<typeof CreateMLCEngine>>
declare const worker: Awaited<ReturnType<typeof CreateWebWorkerMLCEngine>>
declare const sharedOptions: RetryOptions

export const local = VibeRetry(engine, "loaded-model", { timeout: 30_000 })
export const inWorker = fromSubpath(worker, "loaded-model", new VibeRetryConfig())
local.llm = inWorker.llm
export const vendor: Promise<string> = local.llm.client.getGPUVendor()
export const decision: Promise<RetryResult> = local.llm.vibe_eval("decision", RetryResult)
export const wrapRead = local({ max_retries: 2, remarks: "A worker is preparing the file." })
export const result: Promise<number> = wrapRead((n: number) => n + 1)(1)
export const shared: Promise<string> = inWorker(String, sharedOptions)(1)

class Reader {
  @inWorker
  async read(this: Reader, value: string) {
    return value
  }
}
export const read: Promise<string> = new Reader().read("ready")
// @ts-expect-error A wrapped call preserves its argument types.
wrapRead((n: number) => n + 1)("one")
// @ts-expect-error A WebLLM decision has no Jev probability.
local({ probability_threshold: 0.5 })
const cutoff = { max_retries: 2, probability_threshold: 0.5 }
// @ts-expect-error A required numeric threshold also needs Jev in the direct wrapper form.
inWorker(() => 4, cutoff)
