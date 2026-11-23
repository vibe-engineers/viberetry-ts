import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"
import { VibeRetry } from "@vibe-engineers/viberetry"
import OpenAI from "openai"
import ts from "typescript"

test("compiled standard method decorators retry instance and static methods with their receivers", async () => {
  const source = await readFile(new URL("./decorated-service.types.mts", import.meta.url), "utf8")
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  })
  const { serviceClass } = await import(
    `data:text/javascript;base64,${Buffer.from(outputText).toString("base64")}`
  )
  const sdk = new OpenAI({ apiKey: "offline" })
  const prompts = []
  sdk.responses.create = async ({ input }) => {
    prompts.push(input)
    return { output_text: '{"should_retry":true,"delay":0}' }
  }
  const Service = serviceClass(VibeRetry(sdk, "model"))
  const one = new Service()
  const two = new Service()
  assert.equal(await one.load("one"), "one")
  assert.equal(await two.load("two"), "two")
  assert.equal(await Service.available(), 3)
  assert.deepEqual([one.attempts, two.attempts, Service.attempts], [2, 2, 3])
  assert.deepEqual(
    prompts.map((prompt) => JSON.parse(prompt.split("\nCONTEXT:\n").at(-1)).function_name),
    ["load", "load", "available", "available"],
  )
  assert.ok(prompts.at(-1).includes("ADDITIONAL REMARKS: wait for inventory"))
})
