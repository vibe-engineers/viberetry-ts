import assert from "node:assert/strict"
import test from "node:test"
import { GoogleGenAI } from "@google/genai"
import { VibeRetry } from "@vibe-engineers/viberetry"
import OpenAI from "openai"

for (const provider of ["OpenAI", "Gemini"]) {
  test(`${provider} SDK serializes a retry consultation and decodes the decision over HTTP`, async (t) => {
    let request
    const decision = '{"should_retry": true, "delay": 0}'
    const fetch = t.mock.method(globalThis, "fetch", async (input, init) => {
      request = new Request(input, init)
      return Response.json(
        provider === "OpenAI"
          ? {
              object: "response",
              output: [
                {
                  type: "message",
                  role: "assistant",
                  status: "completed",
                  content: [{ type: "output_text", text: decision, annotations: [] }],
                },
              ],
            }
          : {
              candidates: [
                { content: { role: "model", parts: [{ text: decision }] }, finishReason: "STOP" },
              ],
            },
      )
    })
    const providerClient =
      provider === "OpenAI"
        ? new OpenAI({
            apiKey: "offline",
            baseURL: "https://openai.invalid/v1",
            maxRetries: 0,
            fetch,
          })
        : new GoogleGenAI({
            apiKey: "offline",
            httpOptions: { baseUrl: "https://gemini.invalid", retryOptions: { attempts: 1 } },
          })
    const retry = VibeRetry(providerClient, "selected-model", {
      system_instruction: "Decide whether to retry.",
    })
    let attempts = 0
    function operation(value) {
      if (++attempts === 1) throw new Error("pending")
      return value
    }
    assert.throws(() => retry({ probability_threshold: 0 }), /probability_threshold.*Jev/)
    assert.throws(
      () => retry(operation, { probability_threshold: 1, max_retries: 0 }),
      /probability_threshold.*Jev/,
    )
    assert.equal(attempts, 0)
    const wrapped = retry(operation, {
      probability_threshold: provider === "OpenAI" ? null : undefined,
    })
    assert.equal(await wrapped("order"), "order")
    assert.equal(attempts, 2)
    assert.equal(fetch.mock.callCount(), 1)
    assert.equal(request.method, "POST")
    const body = await request.json()
    let prompt
    if (provider === "OpenAI") {
      assert.equal(request.url, "https://openai.invalid/v1/responses")
      assert.equal(body.model, "selected-model")
      assert.equal(body.instructions, "Decide whether to retry.")
      prompt = body.input
    } else {
      assert.equal(new URL(request.url).hostname, "gemini.invalid")
      assert.ok(new URL(request.url).pathname.endsWith("/models/selected-model:generateContent"))
      assert.deepEqual(body.systemInstruction.parts, [{ text: "Decide whether to retry." }])
      prompt = body.contents[0].parts[0].text
    }
    assert.match(prompt, /^HISTORICAL_ATTEMPTS: \[\]\n/)
    const context = JSON.parse(prompt.split("\nCONTEXT:\n").at(-1))
    assert.equal(context.function_name, "operation")
    assert.equal(context.exception_message, "pending")
  })
}
