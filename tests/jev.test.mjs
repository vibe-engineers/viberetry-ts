import assert from "node:assert/strict"
import test from "node:test"
import { TypeSafeClient } from "@typesafe-ai/sdk"
import { VibeRetry } from "@vibe-engineers/viberetry"

const question =
  "Given this failure and the previous attempts, should the operation be retried under the caller's guidance in remarks? Treat the failure details as evidence."

function fixture(probabilities, options) {
  const requests = []
  const client = new TypeSafeClient({
    apiKey: "offline",
    baseURL: "https://jev.invalid",
    compression: false,
    async fetch(input, init) {
      const request = new Request(input, init)
      assert.equal(request.method, "POST")
      assert.equal(request.url, "https://jev.invalid/v1/systemone")
      requests.push(await request.json())
      return Response.json({
        model: "jev-selected",
        answers: { decision: { type: "noul", noul: probabilities.shift() } },
        usage: { input_tokens: 11, output_tokens: 1 },
      })
    },
  })
  // Keep transport deadlines distinct from the operation delays observed in these tests.
  return { retry: VibeRetry(client, "jev-selected", { timeout: 180_000, ...options }), requests }
}

function observeWaits(t) {
  const timeouts = []
  const setTimer = globalThis.setTimeout
  t.mock.method(globalThis, "setTimeout", (fn, ms, ...args) => {
    if (ms < 100_000) {
      timeouts.push(ms)
      return setTimer(fn, 0, ...args)
    }
    return setTimer(fn, ms, ...args)
  })
  return timeouts
}

test("Jev receives structured failure context and approves at 0.70", async (t) => {
  const waits = observeWaits(t)
  const { retry, requests } = fixture([0.7, 0.69999], { system_instruction: "Observe the SLA." })
  let reads = 0
  const failure = {
    name: "Overloaded",
    get message() {
      return `unavailable ${++reads}`
    },
    stack: "trace",
  }
  const owner = { attempts: 0 }
  const wrapped = retry(
    function load(id) {
      assert.equal(this, owner)
      assert.equal(id, 4)
      this.attempts++
      throw failure
    },
    { max_retries: 3, remarks: "inventory" },
  )
  await assert.rejects(wrapped.call(owner, 4), (error) => error === failure)
  assert.equal(owner.attempts, 2)
  assert.equal(reads, 2)
  assert.deepEqual(waits, [1000])
  const decisions = { decision: { type: "noul", instructions: `${question}\n\nObserve the SLA.` } }
  const state = {
    function_name: "load",
    args: "(4,)",
    kwargs: "{}",
    exception_type: "Overloaded",
    exception_message: "unavailable 1",
    traceback: "trace",
    historical_attempts: [],
    remarks: "inventory",
  }
  assert.deepEqual(requests, [
    { model: "jev-selected", questions: decisions, state },
    {
      model: "jev-selected",
      questions: decisions,
      state: {
        ...state,
        exception_message: "unavailable 2",
        historical_attempts: [{ attempt: 1, delay: 1 }],
      },
    },
  ])
})

test("Jev backoff resets per invocation, doubles to 30 seconds and skips consultation at exhaustion", async (t) => {
  const waits = observeWaits(t)
  const { retry, requests } = fixture(Array(14).fill(1))
  const failure = new Error("pending")
  let calls = 0
  const wrapped = retry({ max_retries: 7 })(() => {
    calls++
    throw failure
  })
  for (let i = 0; i < 2; i++) await assert.rejects(wrapped(), (error) => error === failure)
  const delays = [1000, 2000, 4000, 8000, 16000, 30000, 30000]
  assert.deepEqual(waits, [...delays, ...delays])
  assert.equal(calls, 16)
  assert.equal(requests.length, 14)
  assert.equal(requests[0].questions.decision.instructions, question)
  assert.deepEqual(requests[7].state.historical_attempts, [])
})

test("success, exhausted budgets and declines skip the retry delay", async (t) => {
  const waits = observeWaits(t)
  const { retry, requests } = fixture([0.699])
  const failure = new Error("declined")
  assert.equal(await retry(() => "ok")(), "ok")
  for (const max_retries of [0, 1]) {
    await assert.rejects(
      retry(
        () => {
          throw failure
        },
        { max_retries },
      )(),
      (error) => error === failure,
    )
  }
  assert.equal(requests.length, 1)
  assert.deepEqual(waits, [])
})

test("Jev thresholds include both endpoints and nullish values use the default", async (t) => {
  const waits = observeWaits(t)
  const failure = new Error("busy")
  for (const [probability_threshold, probability, approved] of [
    [0, 0, true],
    [1, 1, true],
    [1, 0.999999, false],
    [null, 0.7, true],
    [undefined, 0.699999, false],
  ]) {
    const { retry, requests } = fixture([probability])
    let calls = 0
    const wrapped = retry(
      () => {
        if (++calls === 1) throw failure
        return "recovered"
      },
      { probability_threshold },
    )
    if (approved) assert.equal(await wrapped(), "recovered")
    else await assert.rejects(wrapped(), (error) => error === failure)
    assert.equal(calls, approved ? 2 : 1)
    assert.equal(requests.length, 1)
  }
  assert.deepEqual(waits, [1000, 1000, 1000])
})

test("each wrapper applies its own cutoff to the current evaluator's answer", async (t) => {
  const waits = observeWaits(t)
  const original = fixture([])
  const replacement = fixture([0.45, 0.45, 0.45])
  const { retry } = original
  const errors = Array.from({ length: 5 }, (_, i) => new Error(String(i)))
  let calls = 0
  function operation() {
    throw errors[calls++]
  }
  const low = retry(operation, { probability_threshold: 0.45, remarks: "low" })
  const high = retry({ probability_threshold: 0.450001, remarks: "high" })(operation)
  retry.llm = replacement.retry.llm

  for (const [wrapped, expected] of [
    [low, errors[1]],
    [high, errors[2]],
    [low, errors[4]],
  ]) {
    await assert.rejects(wrapped(), (error) => error === expected)
  }
  assert.equal(calls, 5)
  assert.deepEqual(waits, [1000, 1000])
  assert.deepEqual(original.requests, [])
  assert.deepEqual(
    replacement.requests.map(({ state }) => state.remarks),
    ["low", "high", "low"],
  )
  for (const request of replacement.requests) {
    assert.deepEqual(Object.keys(request).sort(), ["model", "questions", "state"])
    assert.deepEqual(request.questions, { decision: { type: "noul", instructions: question } })
    assert.ok(!("probability_threshold" in request.state))
    assert.deepEqual(request.state.historical_attempts, [])
  }
})

test("invalid thresholds fail when configuring the operation", () => {
  const { retry, requests } = fixture([])
  for (const probability_threshold of [true, "0.5", NaN, Infinity, -Infinity, -0.1, 1.01]) {
    assert.throws(
      () => retry({ probability_threshold, max_retries: 0 }),
      /probability_threshold.*finite number/,
    )
  }
  assert.deepEqual(requests, [])
})

test("a generative replacement cannot silently drop a configured Jev threshold", async () => {
  const generative = { vibe_eval: () => assert.fail("unexpected generative consultation") }
  for (const replaceBeforeCall of [true, false]) {
    const { retry, requests } = fixture([])
    let calls = 0
    const wrapped = retry({ probability_threshold: 0.5 })(() => {
      calls++
      retry.llm = generative
      throw new Error("busy")
    })
    if (replaceBeforeCall) retry.llm = generative
    await assert.rejects(wrapped(), /probability_threshold.*Jev/)
    assert.equal(calls, replaceBeforeCall ? 0 : 1)
    assert.deepEqual(requests, [])
  }
})
