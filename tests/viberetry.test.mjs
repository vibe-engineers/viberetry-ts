import assert from "node:assert/strict"
import test from "node:test"
import { inspect } from "node:util"
import OpenAI from "openai"
import * as viberetry from "@vibe-engineers/viberetry"
import { VibeRetryConfig } from "@vibe-engineers/viberetry/config/config"
import { RetryResult } from "@vibe-engineers/viberetry/models/models"
import { console_logger } from "@vibe-engineers/viberetry/utils/logger"
import { VibeRetry } from "@vibe-engineers/viberetry/viberetry"
import {
  VibeLlmClientException,
  VibeResponseParseException,
  VibeTimeoutException,
} from "@vibe-engineers/vibetools"
import { ConsoleLogger, VibeConfig, VibeLlmClient } from "@vibe-engineers/vibetools/_internal"

function fixture(respond = () => assert.fail("Unexpected provider call"), config) {
  const client = new OpenAI({ apiKey: "offline" })
  const prompts = []
  client.responses.create = async ({ input }) => {
    prompts.push(input)
    return { output_text: await respond(prompts.length) }
  }
  return { retry: VibeRetry(client, "model", config), prompts }
}

const decision = (should_retry, delay = 0) => JSON.stringify({ should_retry, delay })
const history = (prompt) => JSON.parse(prompt.split("\n")[0].slice("HISTORICAL_ATTEMPTS: ".length))
const context = (prompt) => JSON.parse(prompt.split("\nCONTEXT:\n").at(-1))

test("the public factory shares the Python module surface and named VibeTools logger", () => {
  assert.deepEqual(Object.keys(viberetry), ["VibeRetry"])
  assert.equal(viberetry.VibeRetry, VibeRetry)
  assert.equal(VibeRetry.name, "VibeRetry")
  const { retry } = fixture()
  assert.ok(retry.llm instanceof VibeLlmClient)
  assert.ok(retry.llm.config instanceof VibeRetryConfig)
  assert.ok(console_logger instanceof ConsoleLogger)
  assert.equal(retry.llm.logger, console_logger)
  assert.equal(console_logger.name, "VibeRetry")
  assert.throws(() => VibeRetry({}, "model"), VibeLlmClientException)
})

test("default, plain, null and subclassed config use the shared settings", () => {
  const { retry } = fixture(undefined, null)
  assert.equal(retry.llm.config.timeout, 10_000)
  assert.equal(retry.llm.config.vibe_mode, "chill")
  assert.match(retry.llm.config.system_instruction, /"delay": an integer number of seconds/)
  assert.ok(Object.isFrozen(retry.llm.config))
  assert.notEqual(retry.llm.config, fixture().retry.llm.config)
  class CustomConfig extends VibeRetryConfig {
    extra = "test"
  }
  const config = new CustomConfig({ system_instruction: null, timeout: 321 })
  assert.equal(fixture(undefined, config).retry.llm.config, config)
  const shared = new VibeConfig({ timeout: 42 })
  assert.equal(fixture(undefined, shared).retry.llm.config, shared)
  assert.equal(config.system_instruction, null)
  assert.throws(() => {
    config.timeout = 0
  }, TypeError)
  assert.equal(
    fixture(undefined, { system_instruction: "" }).retry.llm.config.system_instruction,
    "",
  )
  for (const invalid of [42, [], new Date(), { max_retries: 1 }]) {
    assert.throws(() => fixture(undefined, invalid), TypeError)
  }
})

test("a system instruction getter is read once when creating the retry decorator", () => {
  let reads = 0
  const { retry } = fixture(undefined, {
    get system_instruction() {
      return `Instruction ${++reads}`
    },
  })
  assert.equal(retry.llm.config.system_instruction, "Instruction 1")
  assert.equal(reads, 1)
})

test("success resolves the original value and preserves arguments, receiver, name and arity", async () => {
  const { retry, prompts } = fixture()
  const owner = {}
  const item = Object.freeze({ value: 5 })
  function select(first, second) {
    assert.equal(this, owner)
    assert.equal(first, item)
    assert.equal(second, 4)
    return first
  }
  for (const wrap of [retry, retry(), retry({}), (fn) => retry(fn, {})]) {
    const wrapped = wrap(select)
    const pending = wrapped.call(owner, item, 4)
    assert.ok(pending instanceof Promise)
    assert.equal(await pending, item)
    assert.equal(wrapped.name, select.name)
    assert.equal(wrapped.length, 2)
  }
  assert.deepEqual(prompts, [])
})

test("zero and negative limits invoke the target once and skip the provider", async () => {
  for (const max_retries of [0, -1]) {
    const { retry, prompts } = fixture()
    const error = new Error("failed")
    let calls = 0
    const wrapped = retry({ max_retries })(() => {
      calls++
      throw error
    })
    await assert.rejects(wrapped(), (failure) => failure === error)
    assert.equal(calls, 1)
    assert.deepEqual(prompts, [])
  }
})

test("default budget permits one extra attempt and exhaustion propagates the latest rejection", async () => {
  const { retry, prompts } = fixture(() => decision(true))
  const failures = [new Error("first"), new RangeError("last")]
  let calls = 0
  const wrapped = retry(async () => {
    throw failures[calls++]
  })
  await assert.rejects(wrapped(), (error) => error === failures[1])
  assert.equal(calls, 2)
  assert.equal(prompts.length, 1)
})

test("a decline after approval propagates the latest error and includes only approved attempts", async () => {
  const { retry, prompts } = fixture((call) => decision(call === 1, call === 1 ? -2 : 10))
  const failures = [new TypeError("one"), new RangeError("two")]
  failures[0].stack = `start${"x".repeat(3996)}tail`
  const owner = { count: 0 }
  const input = { id: 4 }
  const wrapped = retry({ max_retries: 3, remarks: "take it slowly\nif needed" })(
    function load(arg, flag) {
      assert.equal(this, owner)
      assert.equal(arg, input)
      assert.equal(flag, true)
      throw failures[this.count++]
    },
  )
  await assert.rejects(wrapped.call(owner, input, true), (err) => err === failures[1])
  assert.equal(owner.count, 2)
  assert.deepEqual(prompts.map(history), [[], [{ attempt: 1, delay: -2 }]])
  assert.equal(prompts[1].split("\n")[0], 'HISTORICAL_ATTEMPTS: [{"attempt": 1, "delay": -2}]')
  assert.ok(prompts[0].includes('CONTEXT:\n{"function_name": "load", "args": '))
  assert.ok(prompts[0].includes("ADDITIONAL REMARKS: take it slowly\nif needed\nTASK:"))
  assert.deepEqual(context(prompts[0]), {
    function_name: "load",
    args: "({ id: 4 }, true)",
    kwargs: "{}",
    exception_type: "TypeError",
    exception_message: "one",
    traceback: failures[0].stack.slice(-4000),
  })
  assert.equal(context(prompts[1]).exception_message, "two")
})

test("approved waits are in seconds and oversized Node timers are split without overflowing", async (t) => {
  const { retry } = fixture()
  const delays = [1, 2_147_485, 0, -3]
  const timers = []
  t.mock.method(globalThis, "setTimeout", (cb, ms) => {
    timers.push(ms)
    queueMicrotask(cb)
  })
  retry.llm.vibe_eval = async () => ({ should_retry: true, delay: delays.shift() })
  let attempts = 0
  const result = await retry(
    () => {
      if (++attempts < 5) throw new Error("try again")
      return "ok"
    },
    { max_retries: 4 },
  )()
  assert.equal(result, "ok")
  assert.ok(timers.every((ms) => ms > 0 && ms <= 2_147_483_647))
  assert.equal(timers[0], 1000)
  assert.equal(timers.length, 3)
  assert.equal(timers[1] + timers[2], 2_147_485_000)
})

test("arbitrary rejected values retain identity and yield usable failure context", async () => {
  const { retry, prompts } = fixture(() => decision(false))
  for (const reason of [null, undefined, "offline", 0, Symbol("reason"), Object.create(null)]) {
    const outcome = await retry(() => Promise.reject(reason))().then(
      () => assert.fail("expected a rejection"),
      (error) => ({ error }),
    )
    assert.equal(outcome.error, reason)
    const failure = context(prompts.at(-1))
    assert.equal(typeof failure.exception_message, "string")
    assert.ok(failure.exception_type)
    assert.equal(failure.kwargs, "{}")
  }
})

test("circular inputs, BigInts and accessors can be described without running custom inspectors", async () => {
  const { retry, prompts } = fixture(() => decision(false))
  const arg = {
    n: 42n,
    [inspect.custom]() {
      assert.fail("custom inspection ran")
    },
  }
  Object.defineProperty(arg, "secret", {
    enumerable: true,
    get() {
      assert.fail("getter ran")
    },
  })
  arg.self = arg
  const error = new Error("down")
  await assert.rejects(
    retry(() => {
      throw error
    })(arg),
    (failure) => failure === error,
  )
  const args = context(prompts[0]).args
  assert.match(args, /Circular/)
  assert.match(args, /42n/)
  assert.match(args, /Getter/)
})

test("the current evaluator is used by existing wrappers and its own errors escape unchanged", async () => {
  const { retry, prompts } = fixture()
  const error = new Error("consultation failed")
  let calls = 0
  const wrapped = retry(
    () => {
      calls++
      throw new Error("target failed")
    },
    { max_retries: 3 },
  )
  retry.llm = {
    vibe_eval: async () => {
      throw error
    },
  }
  await assert.rejects(wrapped(), (failure) => failure === error)
  assert.equal(calls, 1)
  assert.deepEqual(prompts, [])
})

test("full nested positional data and the last 4,000 Unicode characters reach the evaluator", async () => {
  const { retry, prompts } = fixture(() => decision(false))
  const args = {
    job: { customer: { region: { retryable: false } } },
    items: Array.from({ length: 130 }, (_, i) => i),
  }
  class DeliveryError extends Error {}
  const error = new DeliveryError("down")
  error.stack = `discard${"📦".repeat(3997)}end`
  await assert.rejects(
    retry(() => {
      throw error
    })(args),
    (failure) => failure === error,
  )
  const failure = context(prompts[0])
  assert.match(failure.args, /retryable: false/)
  assert.match(failure.args, /129/)
  assert.equal(failure.exception_type, "DeliveryError")
  assert.equal(failure.traceback, `${"📦".repeat(3997)}end`)
})

test("the evaluation timeout does not limit the target itself", async () => {
  const { retry, prompts } = fixture(undefined, { timeout: 0 })
  const { promise, resolve } = Promise.withResolvers()
  const pending = retry(() => promise)()
  setImmediate(resolve, "finished")
  assert.equal(await pending, "finished")
  assert.deepEqual(prompts, [])
})

test("wrapping a revocable callable retains its name and the actual call failure", async () => {
  const { retry, prompts } = fixture(() => decision(false))
  const { proxy, revoke } = Proxy.revocable(function load() {}, {})
  const wrapped = retry(proxy)
  revoke()
  await assert.rejects(
    wrapped(),
    (failure) => failure instanceof TypeError && failure.message.includes("apply"),
  )
  assert.equal(context(prompts[0]).function_name, "load")
})

test("malformed decisions and evaluator timeouts propagate through shared VibeTools", async () => {
  for (const [reply, timedOut] of [
    [() => '{"should_retry": true}', false],
    [() => '{"should_retry": true, "delay": 9007199254740993}', false],
    [() => new Promise(() => {}), true],
  ]) {
    const { retry, prompts } = fixture(reply, { timeout: timedOut ? 20 : 10_000 })
    let calls = 0
    const wrapped = retry(
      () => {
        calls++
        throw new Error("target")
      },
      { max_retries: 3 },
    )
    await assert.rejects(wrapped(), (error) =>
      timedOut
        ? error instanceof VibeTimeoutException
        : error.cause instanceof VibeResponseParseException,
    )
    assert.equal(calls, 1)
    assert.equal(prompts.length, 1)
  }
})

test("overlapping invocations maintain independent retry counts and histories", async () => {
  const { retry } = fixture()
  const seen = new Map()
  const { promise: ready, resolve } = Promise.withResolvers()
  retry.llm.vibe_eval = async (prompt) => {
    const { exception_message: id } = context(prompt)
    const histories = seen.get(id) ?? []
    histories.push(history(prompt))
    seen.set(id, histories)
    if (seen.size === 2) resolve()
    await ready
    return { should_retry: true, delay: 0 }
  }
  const counts = new Map()
  const wrapped = retry(
    (id) => {
      const count = (counts.get(id) ?? 0) + 1
      counts.set(id, count)
      if (count < 3) throw new Error(id)
      return id
    },
    { max_retries: 2 },
  )
  assert.deepEqual(await Promise.all([wrapped("left"), wrapped("right")]), ["left", "right"])
  assert.deepEqual([...seen.values()], Array(2).fill([[], [{ attempt: 1, delay: 0 }]]))
})

test("retry options reject invalid boundaries before invoking the operation", () => {
  const { retry } = fixture()
  for (const max_retries of [NaN, Infinity, -Infinity, 1.5, 2 ** 53, "2", true]) {
    assert.throws(() => retry({ max_retries }))
  }
  for (const options of [false, [], new Date(), { maxRetries: 1 }, { remarks: 3 }]) {
    assert.throws(() => retry(options), TypeError)
    assert.throws(() => retry(() => 4, options), TypeError)
  }
  assert.throws(() => retry({})(42), TypeError)
})

test("RetryResult validates the decoded Python TypedDict and drops unrecognised fields", () => {
  for (const [input, expected] of [
    [true, 1],
    [false, 0],
    [-2, -2],
    [1.0, 1],
    [-0, 0],
  ]) {
    assert.deepEqual(RetryResult.parse({ should_retry: false, delay: input, extra: "ignored" }), {
      should_retry: false,
      delay: expected,
    })
  }
  for (const invalid of [
    null,
    [],
    {},
    { should_retry: 1, delay: 0 },
    { should_retry: true },
    { delay: 2 },
    { should_retry: true, delay: "0" },
    { should_retry: true, delay: 0.1 },
    { should_retry: true, delay: Infinity },
    { should_retry: true, delay: 2 ** 53 },
  ]) {
    assert.throws(() => RetryResult.parse(invalid))
  }
})

test("RetryResult validates the same field values it ultimately returns", () => {
  let decisions = 0
  let delays = 0
  const result = RetryResult.parse({
    get should_retry() {
      return ++decisions === 1 ? true : "invalid"
    },
    get delay() {
      return ++delays === 1 ? true : 31
    },
  })
  assert.deepEqual(result, { should_retry: true, delay: 1 })
  assert.deepEqual([decisions, delays], [1, 1])
})

test("approved model delays are recorded in subsequent retry decisions", async (t) => {
  const { retry, prompts } = fixture((call) => decision(call <= 2, [6, 2, 99][call - 1]))
  const waits = []
  const setTimer = globalThis.setTimeout
  t.mock.method(globalThis, "setTimeout", (fn, ms, ...args) => {
    if ([6000, 2000, 99000].includes(ms)) {
      waits.push(ms)
      return setTimer(fn, 0, ...args)
    }
    return setTimer(fn, ms, ...args)
  })
  const original = new Error("failed")
  const wrapped = retry({ max_retries: 3 })(() => {
    throw original
  })
  await assert.rejects(wrapped(), (error) => error === original)
  assert.deepEqual(waits, [6000, 2000])
  assert.deepEqual(prompts.map(history), [
    [],
    [{ attempt: 1, delay: 6 }],
    [
      { attempt: 1, delay: 6 },
      { attempt: 2, delay: 2 },
    ],
  ])
})
