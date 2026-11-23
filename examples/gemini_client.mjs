import { GoogleGenAI } from "@google/genai"
import { VibeRetry } from "@vibe-engineers/viberetry"

const apiKey = process.env.GEMINI_API_KEY
if (!apiKey) throw new Error("Set GEMINI_API_KEY to run this example.")
const client = new GoogleGenAI({ apiKey })
const retry = VibeRetry(client, "gemini-3.1-flash-lite")

function simulateFailure() {
  throw new Error("Simulated exception.")
}

const simulateFailureWithRetry = retry({ max_retries: 3, remarks: "use exponential backoff" })(
  simulateFailure,
)
await simulateFailureWithRetry()
