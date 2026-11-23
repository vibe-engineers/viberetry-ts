import { isPlainObject } from "@vibe-engineers/vibetools/_internal/vibe_config"

/** An approved or declined retry and its delay in seconds. */
export interface RetryResult {
  should_retry: boolean
  delay: number
}

/** Runtime counterpart of the Python TypedDict, consumed by VibeTools' schema parser. */
export const RetryResult = {
  parse(value: unknown): RetryResult {
    if (
      !isPlainObject(value) ||
      !Object.hasOwn(value, "should_retry") ||
      !Object.hasOwn(value, "delay")
    ) {
      throw new TypeError("A retry decision must contain should_retry and delay.")
    }
    const { should_retry, delay: rawDelay } = value
    if (typeof should_retry !== "boolean") throw new TypeError("should_retry must be a boolean.")
    // Python accepts booleans as integers and converts the delay with int().
    const delay = typeof rawDelay === "boolean" ? Number(rawDelay) : rawDelay
    if (typeof delay !== "number" || !Number.isSafeInteger(delay)) {
      throw new TypeError("delay must be a safe integer number of seconds.")
    }
    return { should_retry, delay: delay || 0 }
  },
}
