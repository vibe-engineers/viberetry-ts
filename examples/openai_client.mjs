import { VibeRetry } from "@vibe-engineers/viberetry"
import OpenAI from "openai"

const apiKey = process.env.OPENAI_API_KEY
if (!apiKey) throw new Error("Set OPENAI_API_KEY to run this example.")
const client = new OpenAI({ apiKey })
const retry = VibeRetry(client, "gpt-5.6-luna")

function simulateFailure() {
  throw new Error("Simulated exception.")
}

const simulateFailureWithRetry = retry({ max_retries: 3, remarks: "use exponential backoff" })(
  simulateFailure,
)
await simulateFailureWithRetry()
