<p align="center">
  <img width="300" src="assets/viberetry.png" alt="VibeRetry logo" />
</p>
<h1 align="center">VibeRetry</h1>

<p align="center">
  <a href="https://github.com/vibe-engineers/viberetry-ts/actions/workflows/ci.yml"><img src="https://github.com/vibe-engineers/viberetry-ts/actions/workflows/ci.yml/badge.svg" alt="CI" /></a>
  <a href="https://www.npmjs.com/package/@vibe-engineers/viberetry"><img src="https://img.shields.io/npm/v/@vibe-engineers/viberetry" alt="npm version" /></a>
  <a href="https://github.com/vibe-engineers/viberetry-ts/blob/main/package.json"><img src="https://img.shields.io/badge/node-%3E%3D22.13.0-43853d" alt="Node.js 22.13 or later" /></a>
  <a href="https://github.com/vibe-engineers/viberetry-ts/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue" alt="MIT license" /></a>
  <a href="https://www.npmjs.com/package/@vibe-engineers/viberetry"><img src="https://img.shields.io/npm/dm/@vibe-engineers/viberetry" alt="Monthly npm downloads" /></a>
</p>

## Table of Contents

- [Introduction](#introduction)
- [Using Jev](#using-jev)
- [Using WebLLM in a browser](#using-webllm-in-a-browser)
- [Features](#features)
- [Technologies](#technologies)
- [Team](#team)
- [Contributing](#contributing)
- [Others](#others)

### Introduction

**VibeRetry** asks a model whether to retry a failed function call. Pass an OpenAI, Google Gemini, or TypeSafe client, or an initialized WebLLM engine, along with the model name. Wrap your function and `await` the result. This example wraps a function that always throws. Set `GEMINI_API_KEY` to run it.

```ts
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
```

Here Gemini can request up to three more calls, choosing the delay in seconds each time. The example ends with the simulated error when the model declines or the retries run out. A successful call returns immediately without contacting the model.

Install VibeRetry with the SDK for your provider.

```sh
# Google Gemini
npm install @vibe-engineers/viberetry "@google/genai@^3.6.1"

# OpenAI
npm install @vibe-engineers/viberetry "openai@^7.62.0"

# TypeSafe Jev
npm install @vibe-engineers/viberetry "@typesafe-ai/sdk@^0.7.0"
```

For setup from source, provider examples, and the available APIs, see the [Developer Guide](docs/DeveloperGuide.md).

### Using Jev

Set `TYPESAFE_API_KEY` in your environment. This example reads a file that a background worker may still be writing. [TypeSafe JavaScript SDK](https://github.com/typesafe-ai/typesafe-sdk-js)

The factory's optional third argument sets the model's instructions, timeout, and evaluation attempts. Pass `probability_threshold` to the returned wrapper to choose a cutoff for a particular function.

```ts
import { readFile } from "node:fs/promises"
import { TypeSafeClient } from "@typesafe-ai/sdk"
import { VibeRetry } from "@vibe-engineers/viberetry"

const retry = VibeRetry(new TypeSafeClient(), "jev-1.14.0")
const readReport = retry({
  max_retries: 3,
  probability_threshold: 0.8,
  remarks: "A worker creates report.txt when the report is ready.",
})(() => readFile("report.txt", "utf8"))

console.log(await readReport())
```

If the read fails, Jev judges whether another attempt makes sense using the failure, your remarks, and earlier retries. By default, VibeRetry approves a retry at a probability of `0.7` or higher. The example raises `probability_threshold` to `0.8` for this operation. Approved retries wait 1, 2, 4, 8, 16, then 30 seconds each. [Retry decisions](docs/DeveloperGuide.md#retry-decisions)

### Using WebLLM in a browser

VibeRetry 0.1.1 can ask a local model for the retry decision and delay. Install WebLLM in your browser app alongside VibeRetry.

```sh
npm install "@vibe-engineers/viberetry@^0.1.1" "@mlc-ai/web-llm@^0.2.89"
```

Run the app over HTTPS or localhost in a browser with WebGPU. WebLLM downloads the model on first use. Initialize the engine once and pass its loaded model ID. You can also pass the engine returned by `CreateWebWorkerMLCEngine`. [WebLLM](https://github.com/mlc-ai/web-llm)

```ts
import { CreateMLCEngine } from "@mlc-ai/web-llm"
import { VibeRetry } from "@vibe-engineers/viberetry"

const model = "Llama-3.2-1B-Instruct-q4f16_1-MLC"
const engine = await CreateMLCEngine(model, undefined, { temperature: 0 })
const retry = VibeRetry(engine, model, { timeout: 30_000 })

let calls = 0
const readStatus = retry(
  () => {
    if (++calls === 1) throw new Error("HTTP 503 Service Unavailable")
    return "ready"
  },
  { max_retries: 1, remarks: "Retry HTTP 503 once. Set delay to the integer 0 seconds." },
)

console.log(await readStatus())
```

If the model approves a retry, the second call returns `"ready"`. If it declines, the wrapper throws the original error. The example uses a sampling temperature of zero for repeatability. Test both the decision and the proposed delay on recoverable and permanent failures from your application. [Retry decisions](docs/DeveloperGuide.md#retry-decisions)

### Features

- **Retry guidance.** Use `remarks` to tell the model when another attempt makes sense.
- **Multi-provider support.** Use the same wrapper with OpenAI, Google Gemini, Jev, or a local WebLLM engine.
- **Extensible design.** VibeTools supplies the provider adapters. VibeRetry supplies the retry loop, decision schema, and default instruction.
- **Custom exceptions.** Handle the original function error or an error evaluating the model's decision. [Error handling](docs/DeveloperGuide.md#error-handling)

### Technologies

##### Done with

<p align="center">
  <img height="150" width="150" src="https://www.typescriptlang.org/branding/ts-logo-128.svg" alt="TypeScript logo" />
</p>
<p align="center">TypeScript on Node.js 22.13 or later and in WebGPU-capable browsers</p>

##### Project Repository

[vibe-engineers/viberetry-ts](https://github.com/vibe-engineers/viberetry-ts) · [Python implementation](https://github.com/vibe-engineers/viberetry)

### Team

- [Kong Le-Yi](https://github.com/konglyyy)
- [Tan Jin](https://github.com/tjtanjin)

### Contributing

To contribute to VibeRetry, fork the repository and open a pull request describing the change and how you tested it. The repository includes issue and pull request templates. [Developer Guide](docs/DeveloperGuide.md) · [Contributing](CONTRIBUTING.md)

For bugs or suggestions, open an issue or discuss it with the team on Discord. [GitHub issues](https://github.com/vibe-engineers/viberetry-ts/issues) · [Community Discord](https://discord.gg/dBW35GBCPZ)

### Others

For implementation questions, reach the team on Discord. To report a vulnerability privately, follow the security policy. [Community Discord](https://discord.gg/dBW35GBCPZ) · [Security policy](SECURITY.md)
