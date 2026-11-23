import {
  describeValue,
  formatPositionalArgs,
  readProperty,
} from "@vibe-engineers/vibetools/_internal/prompt"

export type HistoricalAttempt = { attempt: number; delay: number }

/** Match json.dumps' default separators for the flat prompt and history records. */
function jsonRecord(record: Record<string, string | number>): string {
  const fields = Object.entries(record).map(
    ([key, value]) => `${JSON.stringify(key)}: ${JSON.stringify(value)}`,
  )
  return `{${fields.join(", ")}}`
}

function tracebackTail(stack: unknown): string {
  if (typeof stack !== "string") return ""
  if (stack.length <= 4000) return stack
  // Python slices Unicode code points. Each occupies at most two UTF-16 code units.
  return Array.from(stack.slice(-8000)).slice(-4000).join("")
}

export function failureContext(name: string, args: unknown[], error: unknown) {
  const errorName = readProperty(error, "name")
  const className = readProperty(readProperty(error, "constructor"), "name")
  const message = readProperty(error, "message")
  const stack = readProperty(error, "stack")
  // Custom Error subclasses inherit the generic name "Error" unless they override it.
  const fallbackType =
    typeof className === "string" && className ? className : error === null ? "null" : typeof error
  const type =
    typeof errorName === "string" && errorName && errorName !== "Error" ? errorName : fallbackType
  return {
    function_name: name,
    args: formatPositionalArgs(args),
    kwargs: "{}",
    exception_type: type,
    exception_message:
      typeof message === "string"
        ? message
        : typeof error === "string"
          ? error
          : describeValue(error),
    traceback: tracebackTail(stack),
  }
}

export function failurePrompt(
  context: ReturnType<typeof failureContext>,
  history: HistoricalAttempt[],
  remarks: string,
): string {
  return (
    `HISTORICAL_ATTEMPTS: [${history.map(jsonRecord).join(", ")}]\n` +
    `ADDITIONAL REMARKS: ${remarks}\n` +
    "TASK: Given the following failure context, decide whether to retry and for how long.\n\n" +
    `CONTEXT:\n${jsonRecord(context)}`
  )
}
