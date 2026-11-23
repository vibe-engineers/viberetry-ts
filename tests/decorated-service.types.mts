import type { VibeRetry } from "@vibe-engineers/viberetry"

export function serviceClass(retry: ReturnType<typeof VibeRetry>) {
  return class Service {
    attempts = 0
    static attempts = 0

    @retry
    async load(this: Service, value: string) {
      if (++this.attempts === 1) throw new Error("unavailable")
      return value
    }

    @retry({ max_retries: 2, remarks: "wait for inventory" })
    static async available(this: typeof Service) {
      // biome-ignore lint/complexity/noThisInStatic: The test checks the static method receiver.
      const attempt = ++this.attempts
      if (attempt <= 2) throw new Error("busy")
      return attempt
    }
  }
}
