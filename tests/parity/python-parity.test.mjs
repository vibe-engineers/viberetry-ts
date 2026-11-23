import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { test } from "node:test"
import { fileURLToPath } from "node:url"
import { GoogleGenAI } from "@google/genai"
import { VibeRetry } from "@vibe-engineers/viberetry"
import { VibeRetryConfig } from "@vibe-engineers/viberetry/config/config"
import OpenAI from "openai"

const yes = (delay) => JSON.stringify({ should_retry: true, delay })
const no = (delay) => JSON.stringify({ should_retry: false, delay })

const cases = [
  { name: "bare success", form: "bare", failures: [], replies: [], value: false },
  { name: "default decline", failures: ["first"], replies: [no(3)] },
  { name: "recover on the default retry", form: "bare", failures: ["first"], replies: [yes(0)] },
  { name: "default exhaustion", failures: ["first", "last"], replies: [yes(0)] },
  {
    name: "decline after a retry rethrows the latest error by identity",
    form: "direct",
    options: { max_retries: 3 },
    failures: ["same message", "same message"],
    replies: [yes(2), no(3)],
  },
  ...[0, -1, -12].map((max_retries) => ({
    name: `no retry with a budget of ${max_retries}`,
    options: { max_retries },
    failures: ["initial failure"],
    replies: [],
  })),
  {
    name: "numbered history, zero and negative delays, remarks and arguments",
    options: { max_retries: 4, remarks: "Pas de réseau.\nTry again for 🐕." },
    args: ["sample-π", 27],
    failures: ["first", "network\ninterrupted", 'third "error"', "fourth"],
    replies: [yes(-2), yes(0), yes(3), no(1)],
  },
  {
    name: "last error on exhaustion after multiple approved retries",
    form: "direct",
    options: { max_retries: 2 },
    failures: ["first", "second", "third"],
    replies: [yes(1), yes(2)],
  },
  {
    name: "same wrapper starts a fresh retry budget and history on each invocation",
    failures: ["temporary"],
    replies: [yes(2), yes(0)],
    args: ["again"],
    runs: 2,
    value: null,
  },
  {
    name: "overridden instruction",
    config: { system_instruction: "Custom retry instruction." },
    failures: ["busy"],
    replies: [yes(0)],
  },
  {
    name: "explicit null instruction on a config instance",
    config: { system_instruction: null },
    config_instance: true,
    failures: ["busy"],
    replies: [no(0)],
  },
  {
    name: "extra model fields are ignored",
    failures: ["busy"],
    replies: ['{"extra":{"details":true},"should_retry":true,"delay":0}'],
  },
  {
    name: "boolean delays become integer seconds in history",
    options: { max_retries: 3 },
    failures: ["first", "second", "third"],
    replies: [yes(true), yes(false), no(false)],
  },
  { name: "provider failure escapes the wrapper", failures: ["target failure"], replies: [null] },
  {
    name: "malformed decision then successful second model evaluation in eager mode",
    config: { vibe_mode: "EAGER" },
    failures: ["busy"],
    replies: ["malformed", yes(0)],
  },
  {
    name: "provider retries use their own budget and keep the same target history",
    config: { vibe_mode: "aggressive" },
    failures: ["first", "second"],
    replies: [null, "malformed", yes(0), null, null, null],
    options: { max_retries: 2 },
  },
]

for (const reply of [
  "",
  "not json",
  "null",
  "true",
  "[]",
  "{}",
  '{"delay":0}',
  '{"should_retry":true}',
  '{"should_retry":"true","delay":0}',
  '{"should_retry":1,"delay":0}',
  '{"should_retry":false,"delay":"0"}',
  '{"should_retry":true,"delay":0.5}',
  '{"should_retry":true,"delay":null}',
  '{"should_retry":false,"delay":{}}',
  '{"should_retry":null,"delay":0}',
  '```json\n{"should_retry":true,"delay":0}\n```',
]) {
  cases.push({
    name: `invalid decision ${JSON.stringify(reply)}`,
    failures: ["busy"],
    replies: [reply],
  })
}

function sdkFor(provider, answer, offline) {
  if (provider === "openai") {
    const sdk = new OpenAI({ apiKey: "offline", fetch: offline, maxRetries: 0 })
    sdk.responses.create = async ({ model, instructions, input }) => ({
      output_text: answer(model, instructions, input),
    })
    return sdk
  }
  const sdk = new GoogleGenAI({ apiKey: "offline" })
  sdk.models.generateContent = async ({ model, config, contents }) => ({
    text: answer(model, config.systemInstruction ?? null, contents),
  })
  return sdk
}

async function runCase(provider, scenario, events, offline) {
  let nextReply = 0
  const sdk = sdkFor(
    provider,
    (model, instruction, prompt) => {
      events.push(["consult", model, instruction, prompt])
      assert.ok(nextReply < scenario.replies.length, "unexpected extra consultation")
      const reply = scenario.replies[nextReply++]
      if (reply === null) throw new Error("offline provider failure")
      return reply
    },
    offline,
  )
  const config = scenario.config_instance ? new VibeRetryConfig(scenario.config) : scenario.config
  const retry = VibeRetry(sdk, "offline-model", config)
  const errors = []
  function operation(...args) {
    events.push(["call", args])
    if (errors.length < scenario.failures.length) {
      const error = new TypeError(scenario.failures[errors.length])
      errors.push(error)
      throw error
    }
    return "value" in scenario ? scenario.value : "ok"
  }
  let wrapped
  if (scenario.form === "bare") wrapped = retry(operation)
  else if (scenario.form === "direct") wrapped = retry(operation, scenario.options)
  else wrapped = (scenario.options ? retry(scenario.options) : retry())(operation)

  const outcomes = []
  for (let run = 0; run < (scenario.runs ?? 1); run++) {
    errors.length = 0
    try {
      outcomes.push({ value: await wrapped(...(scenario.args ?? [])) })
    } catch (error) {
      const index = errors.indexOf(error)
      if (index !== -1) outcomes.push({ target_error: index })
      else outcomes.push({ error: (error.cause ?? error).name, wrapped: error.cause !== undefined })
    }
  }
  return { outcomes, events }
}

function comparable(result, args) {
  // Prompt text, field names, values and event order are part of the comparison.
  // Locally formatted stack frames and argument punctuation belong to each runtime.
  const events = result.events.map((event) => {
    if (event[0] !== "consult") return event
    const [kind, model, instruction, prompt] = event
    const match =
      /^HISTORICAL_ATTEMPTS: ([^\n]+)\nADDITIONAL REMARKS: ([\s\S]*?)\nTASK: ([^\n]+)\n\nCONTEXT:\n([\s\S]+)$/u.exec(
        prompt,
      )
    assert.ok(match, "unexpected retry prompt structure")
    const [, history, remarks, task, contextJson] = match
    const { args: renderedArgs, traceback, ...context } = JSON.parse(contextJson)
    assert.equal(typeof traceback, "string")
    assert.ok(traceback.length <= 4000 && traceback.includes(context.exception_message))
    assert.ok(traceback.includes(context.function_name))
    assert.equal(typeof renderedArgs, "string")
    // Fixtures use plain positional strings and small integers in both languages.
    const values = Array.from(
      renderedArgs.matchAll(/'([^']*)'|"([^"]*)"|(-?\d+)/gu),
      ([, single, double, number]) => single ?? double ?? Number(number),
    )
    assert.deepEqual(values, args)
    return [kind, model, instruction, JSON.parse(history), remarks, task, context]
  })
  return { outcomes: result.outcomes, events }
}

test("both providers match the Python retry loop, prompts and decision errors", async (t) => {
  const python = process.env.VIBE_PYTHON ?? (process.platform === "win32" ? "python" : "python3")
  const reference = spawnSync(
    python,
    ["-B", fileURLToPath(new URL("./python_reference.py", import.meta.url))],
    {
      input: JSON.stringify(cases),
      encoding: "utf8",
      timeout: 60_000,
    },
  )
  assert.equal(reference.status, 0, reference.error?.message ?? reference.stderr)
  const expected = JSON.parse(reference.stdout)
  const offline = () => {
    throw new Error("Unexpected network transport")
  }
  t.mock.method(globalThis, "fetch", offline)
  let events
  const originalTimer = globalThis.setTimeout
  t.mock.method(globalThis, "setTimeout", (callback, delay, ...args) => {
    // Each scenario's model deadline still uses real time. The only scripted
    // application sleeps and internal model backoffs last 1, 2 or 3 seconds.
    if (delay === 1000 || delay === 2000 || delay === 3000) {
      events.push(["wait", delay / 1000])
      return originalTimer(callback, 0, ...args)
    }
    return originalTimer(callback, delay, ...args)
  })
  for (const provider of ["openai", "gemini"]) {
    assert.equal(expected[provider].length, cases.length)
    for (const [index, scenario] of cases.entries()) {
      events = []
      const actual = await runCase(provider, scenario, events, offline)
      const args = scenario.args ?? []
      assert.deepEqual(
        comparable(actual, args),
        comparable(expected[provider][index], args),
        `${provider}, ${scenario.name}`,
      )
    }
  }
  t.diagnostic(`${cases.length * 2} cross-language comparisons`)
})
