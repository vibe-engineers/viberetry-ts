import type { MLCEngineInterface } from "@mlc-ai/web-llm"
import {
  type RetryWrapper,
  VibeRetry,
  type VibeRetryDecorator,
  type VibeRetryFactory,
} from "@vibe-engineers/viberetry"
import { VibeRetry as fromSubpath } from "@vibe-engineers/viberetry/viberetry"

declare module "@vibe-engineers/viberetry" {
  interface VibeRetryFactory {
    applicationLabel?: string
  }
}
declare module "@vibe-engineers/viberetry/viberetry" {
  interface VibeRetryDecorator {
    applicationLabel?: string
  }
}

declare const engine: MLCEngineInterface
const factory: VibeRetryFactory = VibeRetry
const retry: VibeRetryDecorator = factory(engine, "loaded-model")
export const factoryLabel: string | undefined = fromSubpath.applicationLabel
export const retryLabel: string | undefined = VibeRetry(engine, "loaded-model").applicationLabel
export const vendor: Promise<string> = retry.llm.client.getGPUVendor()
const wrap: RetryWrapper = retry({ probability_threshold: null })
export const available: Promise<boolean> = wrap(() => true)()
const cloud = { responses: { create: async () => ({ output_text: "response" }) } }
// @ts-expect-error Browser factories accept local engines only.
VibeRetry(cloud, "model")
// @ts-expect-error The subpath has the same browser declaration as the root.
fromSubpath(cloud, "model")
