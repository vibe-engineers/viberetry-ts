import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import test from "node:test"
import { VibeRetry } from "@vibe-engineers/viberetry"
import { VibeRetryConfig } from "@vibe-engineers/viberetry/config/config"
import { VibeRetry as fromSubpath } from "@vibe-engineers/viberetry/viberetry"
import {
  VibeLlmApiException,
  VibeResponseParseException,
  VibeTimeoutException,
} from "@vibe-engineers/vibetools"

function engine(create) {
  return { getGPUVendor: async () => "offline", chat: { completions: { create } } }
}

function answer(content, finish_reason = "stop") {
  return { choices: [{ message: { role: "assistant", content }, finish_reason }] }
}

function decision(should_retry, delay = 0) {
  return answer(JSON.stringify({ should_retry, delay }))
}

test("the local decision uses the loaded model, retry instruction, failure and remarks", async () => {
  const requests = []
  const retry = VibeRetry(
    engine(async (request) => {
      requests.push(request)
      return decision(true)
    }),
    "loaded-model",
  )
  const owner = { attempts: 0 }
  const item = { ready: true }
  const read = retry(
    function read(id) {
      if (++this.attempts === 1) throw new Error(`pending ${id}`)
      return item
    },
    { remarks: "The worker is still writing." },
  )
  assert.equal(await read.call(owner, 4), item)
  assert.equal(owner.attempts, 2)
  assert.equal(requests.length, 1)
  const [{ model, messages, stream, response_format }] = requests
  assert.equal(model, "loaded-model")
  assert.equal(stream, false)
  assert.deepEqual(
    messages.map(({ role }) => role),
    ["system", "user", "assistant", "user", "assistant", "user"],
  )
  assert.equal(messages[0].content, new VibeRetryConfig().system_instruction)
  const examples = [1, 3].map((index) => ({
    failure: JSON.parse(messages[index].content.split("\nCONTEXT:\n").at(-1)),
    decision: JSON.parse(messages[index + 1].content),
  }))
  assert.match(examples[0].failure.exception_message, /invalid/)
  assert.deepEqual(examples[0].decision, { should_retry: false, delay: 0 })
  assert.match(examples[1].failure.exception_message, /Network timeout/)
  assert.deepEqual(examples[1].decision, { should_retry: true, delay: 0 })
  const prompt = messages.at(-1).content
  assert.match(
    prompt,
    /^HISTORICAL_ATTEMPTS: \[\]\nADDITIONAL REMARKS: The worker is still writing\./,
  )
  const failure = JSON.parse(prompt.split("\nCONTEXT:\n").at(-1))
  assert.equal(failure.function_name, "read")
  assert.equal(failure.args, "(4,)")
  assert.equal(failure.exception_message, "pending 4")
  assert.equal(response_format.type, "grammar")
  assert.match(response_format.grammar, /should_retry/)
  assert.match(response_format.grammar, /delay/)
  await retry.llm.vibe_eval("raw text")
  assert.deepEqual(
    requests[1].messages.map(({ role }) => role),
    ["system", "user"],
  )
})

test("retry grammar is scoped to retry decisions and respects caller instructions", async () => {
  const requests = []
  const replies = [decision(false), answer("raw text"), answer("true"), answer('{"id":4}')]
  const retry = fromSubpath(
    engine(async (request) => {
      requests.push(request)
      return replies.shift()
    }),
    "m",
    { system_instruction: "Retry only if the file may arrive." },
  )
  const failure = new Error("pending")
  await assert.rejects(retry(() => Promise.reject(failure))(), (error) => error === failure)
  assert.equal(requests[0].messages[0].content, "Retry only if the file may arrive.")
  assert.deepEqual(
    requests[0].messages.map(({ role }) => role),
    ["system", "user"],
  )
  assert.equal(await retry.llm.vibe_eval("text"), "raw text")
  assert.equal(await retry.llm.vibe_eval("boolean", Boolean), true)
  assert.equal(await retry.llm.vibe_eval("id", { parse: (object) => object.id }), 4)
  assert.equal(requests[1].response_format, undefined)
  assert.match(requests[2].response_format.grammar, /True.*False/)
  assert.equal(requests[3].response_format, undefined)
})

test("an existing wrapper consults the current engine and a decline preserves the last error", async () => {
  const requests = []
  const retry = VibeRetry(
    engine(() => assert.fail("used previous engine")),
    "old",
  )
  const errors = [new Error("first"), new Error("last")]
  let attempts = 0
  const work = retry({ max_retries: 3 })(() => {
    throw errors[attempts++]
  })
  retry.llm = fromSubpath(
    engine(async ({ messages }) => {
      requests.push(messages)
      return requests.length === 1 ? decision(true, -2) : decision(false, 900)
    }),
    "replacement",
    { system_instruction: null },
  ).llm
  await assert.rejects(work(), (error) => error === errors[1])
  assert.equal(attempts, 2)
  assert.equal(requests.length, 2)
  assert.deepEqual(
    requests[1].map(({ role }) => role),
    ["user"],
  )
  const prompt = requests[1][0].content
  const attemptsLine = prompt.split("\n")[0].slice("HISTORICAL_ATTEMPTS: ".length)
  assert.deepEqual(JSON.parse(attemptsLine), [{ attempt: 1, delay: -2 }])
  assert.equal(JSON.parse(prompt.split("\nCONTEXT:\n").at(-1)).exception_message, "last")
})

test("local approvals use second-based delays, chunk large timers and stop at the retry budget", async (t) => {
  const timeout = 12_345
  t.mock.method(performance, "now", () => 0)
  const setTimer = globalThis.setTimeout
  const waits = []
  t.mock.method(globalThis, "setTimeout", (fn, ms, ...args) => {
    if (ms === timeout) return setTimer(fn, ms, ...args)
    waits.push(ms)
    return setTimer(fn, 0, ...args)
  })
  const delays = [1, 2_147_485, 0, -3]
  const retry = VibeRetry(
    engine(async () => decision(true, delays.shift())),
    "m",
    { timeout },
  )
  const errors = Array.from({ length: 5 }, (_, i) => new Error(String(i)))
  let attempts = 0
  const work = retry({ max_retries: 4 })(() => {
    throw errors[attempts++]
  })
  await assert.rejects(work(), (error) => error === errors[4])
  assert.equal(attempts, 5)
  assert.deepEqual(delays, [])
  assert.deepEqual(waits, [1000, 2_147_483_000, 2000])
})

test("success and exhausted budgets skip inference, and numeric cutoffs require Jev", async () => {
  const retry = VibeRetry(
    engine(() => assert.fail("unexpected consultation")),
    "m",
  )
  assert.equal(await retry(() => 3, { probability_threshold: null })(), 3)
  const failure = new Error("stopped")
  let attempts = 0
  function work() {
    attempts++
    throw failure
  }
  for (const max_retries of [0, -1]) {
    await assert.rejects(retry(work, { max_retries })(), (error) => error === failure)
  }
  assert.equal(attempts, 2)
  assert.throws(() => retry({ probability_threshold: 0 }), /probability_threshold.*Jev/)
  assert.throws(() => retry(work, { probability_threshold: 1, max_retries: 0 }), /Jev/)
})

test("malformed or incomplete local decisions fail the evaluation before an application retry", async () => {
  for (const reply of [
    answer("not json"),
    answer('{"should_retry":true}'),
    answer('{"should_retry":"yes","delay":0}'),
    answer('{"should_retry":true,"delay":9007199254740993}'),
    answer('{"should_retry":true,"delay":0}', "length"),
    { choices: [] },
  ]) {
    const retry = VibeRetry(
      engine(async () => reply),
      "m",
    )
    let attempts = 0
    const work = retry(() => {
      attempts++
      throw new Error("pending")
    })
    await assert.rejects(work(), (error) => error.cause instanceof VibeResponseParseException)
    assert.equal(attempts, 1)
  }
})

test("a failed engine request and a local evaluation deadline preserve their error types", async () => {
  const deviceFailure = new Error("device lost")
  const work = () => Promise.reject(new Error("pending"))
  const disconnected = engine(() => Promise.reject(deviceFailure))
  await assert.rejects(
    VibeRetry(disconnected, "m")(work)(),
    (error) => error.cause instanceof VibeLlmApiException && error.cause.cause === deviceFailure,
  )
  const idle = engine(() => new Promise(() => {}))
  await assert.rejects(VibeRetry(idle, "m", { timeout: 20 })(work)(), VibeTimeoutException)
})

test("EAGER retries an invalid engine reply before spending an application retry", async (t) => {
  const setTimer = globalThis.setTimeout
  const waits = []
  t.mock.method(globalThis, "setTimeout", (fn, ms, ...args) => {
    if (ms !== 1000) return setTimer(fn, ms, ...args)
    waits.push(ms)
    return setTimer(fn, 0, ...args)
  })
  const prompts = []
  const retry = VibeRetry(
    engine(async ({ messages }) => {
      prompts.push(messages)
      return prompts.length === 1 ? answer('{"delay":0}') : decision(true)
    }),
    "m",
    { vibe_mode: "EAGER" },
  )
  let calls = 0
  const run = retry(() => {
    if (++calls === 1) throw new Error("pending")
    return "ready"
  })
  assert.equal(await run(), "ready")
  assert.equal(calls, 2)
  assert.equal(prompts.length, 2)
  assert.deepEqual(prompts[0], prompts[1])
  assert.deepEqual(waits, [1000])
})

test("the browser entries run with Node globals, built-ins and provider SDK imports unavailable", () => {
  async function runInBrowser() {
    const { default: assert } = await import("node:assert/strict")
    const { register } = await import("node:module")
    const loader = [
      'import { isBuiltin } from "node:module"',
      "export function resolve(name, ctx, next) {",
      '  if (isBuiltin(name) || ["openai","@google/genai","@typesafe-ai/sdk","@mlc-ai/web-llm"].includes(name)) throw Error("Browser imported " + name)',
      "  return next(name, ctx)",
      "}",
    ].join("\n")
    // Initialize Node's browser globals while their implementation still has access to Buffer.
    const headers = new Headers({ "x-region": "north" })
    const form = new FormData()
    form.append("tag", "pending")
    register(`data:text/javascript,${encodeURIComponent(loader)}`, import.meta.url)
    globalThis.process = undefined
    globalThis.Buffer = undefined
    const { VibeRetry } = await import("@vibe-engineers/viberetry")
    const { VibeRetry: fromSubpath } = await import("@vibe-engineers/viberetry/viberetry")
    const { VibeRetryConfig } = await import("@vibe-engineers/viberetry/config/config")
    const { RetryResult } = await import("@vibe-engineers/viberetry/models/models")
    const { console_logger } = await import("@vibe-engineers/viberetry/utils/logger")
    assert.equal(VibeRetry, fromSubpath)
    const calls = []
    const chat = {
      completions: {
        create: async (request) => {
          calls.push(request)
          return {
            choices: [
              { message: { content: '{"should_retry":true,"delay":0}' }, finish_reason: "stop" },
            ],
          }
        },
      },
    }
    assert.throws(() => VibeRetry({ chat }, "m"), { name: "VibeLlmClientException" })
    const retry = VibeRetry(
      { getGPUVendor: async () => "offline", chat },
      "m",
      new VibeRetryConfig(),
    )
    assert.equal(retry.llm.logger, console_logger)
    assert.deepEqual(RetryResult.parse({ should_retry: false, delay: 0 }), {
      should_retry: false,
      delay: 0,
    })
    const arg = {
      id: 42n,
      headers,
      form,
      get value() {
        throw Error("unexpected getter")
      },
    }
    arg.self = arg
    let tries = 0
    const work = retry((input) => {
      if (++tries === 1) throw new Error("pending")
      return input
    })
    assert.equal(await work(arg), arg)
    assert.equal(tries, 2)
    assert.equal(calls.length, 1)
    const context = JSON.parse(calls[0].messages.at(-1).content.split("\nCONTEXT:\n").at(-1))
    assert.match(context.args, /42n/)
    assert.match(context.args, /"x-region": "north"/)
    assert.match(context.args, /"tag": "pending"/)
    assert.match(context.args, /Circular/)
    assert.match(context.args, /Getter/)
  }
  const child = spawnSync(
    process.execPath,
    ["--conditions=browser", "--input-type=module", "-e", `await (${runInBrowser.toString()})()`],
    { cwd: new URL(".", import.meta.url), encoding: "utf8" },
  )
  assert.equal(child.status, 0, child.stderr)
})
