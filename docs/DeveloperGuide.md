<p align="center">
  <img width="220" src="../assets/viberetry.png" alt="VibeRetry logo" />
</p>
<h1 align="center">VibeRetry Developer Guide</h1>

## Table of Contents

- [Introduction](#introduction)
- [Navigating this Developer Guide](#navigating-this-developer-guide)
- [Setup](#setup)
- [Project Structure](#project-structure)
- [Key Concepts & Design](#key-concepts--design)
- [Code Documentation](#code-documentation)
- [Testing](#testing)
- [Pull Requests](#pull-requests)
- [Final Notes](#final-notes)

## Introduction

VibeRetry wraps a function and consults OpenAI, Gemini, Jev, or a local WebLLM engine when it fails. VibeRetry handles the application function, delay, and retry history. Its only required runtime dependency, `@vibe-engineers/vibetools`, handles SDK selection, response parsing, timeouts, and logging. Install the SDK for the provider you use. [VibeRetry README](../README.md) · [Package manifest](../package.json)

## Navigating this Developer Guide

Run the commands in this guide from the root of the VibeRetry TypeScript repository. All project paths below are relative to that directory. [vibe-engineers/viberetry-ts](https://github.com/vibe-engineers/viberetry-ts)

## Setup

Use Node.js 22.13 or later. Once the locked VibeTools version is available on npm, install the dependencies and run the tests.

```sh
npm ci
npm test
```

When working against an unpublished VibeTools change, clone `vibe-engineers/vibetools-ts` alongside this repository and install its local tarball. These commands build the dependency and install it together with the VibeRetry development tools. [VibeTools repository](https://github.com/vibe-engineers/vibetools-ts)

```sh
npm ci --prefix ../vibetools-ts
(cd ../vibetools-ts && npm pack)
npm install --no-save ../vibetools-ts/vibe-engineers-vibetools-0.1.1.tgz
npm test
```

Publish the required VibeTools version before VibeRetry. Compare its npm `dist.integrity` with the VibeTools entry in `package-lock.json`. If the values differ, verify that the published archive's uncompressed tar matches `CORE_TAR_SHA256` in `.github/workflows/ci.yml` before recording the published integrity. Run `npm ci`, `npm test`, and `npm run test:parity` against the published dependency before releasing VibeRetry.

### Live examples

For the standalone OpenAI and Gemini examples, copy `.env.template` to `.env` after building or running the tests. Set one provider key and run the corresponding command below. Each example wraps a function that always throws `Error("Simulated exception.")` and exits with the final error. To inspect its requests and decisions, set `VIBE_LOG_LEVEL=DEBUG` before starting Node. For the Jev file-reading example, set `TYPESAFE_API_KEY` in your environment. [Environment template](../.env.template) · [Jev example](../README.md#using-jev) · [Gemini example model](https://aistudio.google.com/docs/models/gemini-3.1-flash-lite) · [OpenAI example model](https://developers.openai.com/api/docs/models/gpt-5.6-luna)

| Provider      | Environment variable | Command                                                     |
| ------------- | -------------------- | ----------------------------------------------------------- |
| Google Gemini | `GEMINI_API_KEY`     | `node --env-file-if-exists=.env examples/gemini_client.mjs` |
| OpenAI        | `OPENAI_API_KEY`     | `node --env-file-if-exists=.env examples/openai_client.mjs` |

### Installing the local packages

With both repositories set up as above, install their archives and your provider SDK together in the consuming application. Replace `/path/to/your-app` with its directory. The command below selects OpenAI. To use Gemini or Jev, substitute `"@google/genai@^3.6.1"` or `"@typesafe-ai/sdk@^0.7.0"` respectively. Create the client with the same installed copy of the SDK that VibeTools resolves.

```sh
(cd ../vibetools-ts && npm pack)
npm pack
npm install --prefix /path/to/your-app \
  "$PWD/../vibetools-ts/vibe-engineers-vibetools-0.1.1.tgz" \
  "$PWD/vibe-engineers-viberetry-0.1.1.tgz" \
  "openai@^7.62.0"
```

For a browser app, install `@mlc-ai/web-llm@^0.2.89` with the two archives. Browser bundlers select the `browser` condition for both `@vibe-engineers/viberetry` and `@vibe-engineers/viberetry/viberetry`. To have TypeScript select the browser declarations as well, use `moduleResolution: "Bundler"` and `customConditions: ["browser"]`. Your app owns the model download, progress reporting, and engine lifetime. Reuse its main-thread or worker engine across wrapped operations. [Browser example](../README.md#using-webllm-in-a-browser)

## Project Structure

- _src/index.ts_ exports the public `VibeRetry` factory.
- _src/viberetry.ts_ selects the evaluator for Node callers. _src/browser.ts_ accepts a WebLLM engine.
- _src/retry.ts_ wraps calls, captures failures, and applies each model decision in both environments.
- _src/webllm.ts_ defines the grammar and examples for local retry decisions.
- _src/config/config.ts_ defines `VibeRetryConfig` and the default system instruction.
- _src/models/models.ts_ defines and validates the structured `RetryResult`.
- _src/utils/logger.ts_ configures the `VibeRetry` console logger.
- _src/utils/prompt.ts_ formats the failure context and history sent to the model.
- _tests/_ covers the public API, TypeScript declarations, and Python compatibility.
- _examples/_ demonstrates the same simulated failure with both SDKs. [Gemini](../examples/gemini_client.mjs) · [OpenAI](../examples/openai_client.mjs)

## Key Concepts & Design

### VibeRetry decorator

`VibeRetry(client, model, config?)` accepts model evaluation settings in its optional third argument. It returns a callable linked to the evaluator through its `llm` property. Apply it to an ordinary function with `retry(fn)` or `retry()(fn)`. Use `retry(options)(fn)` or `retry(fn, options)` to set `max_retries`, `remarks`, or a Jev `probability_threshold` for that operation.

Library authors can export an initialized retry instance or a configured decorator and let TypeScript infer its provider type. For explicit annotations, `@vibe-engineers/viberetry` exports `VibeRetryDecorator`, `RetryOptions`, and `RetryWrapper`. The default evaluator type for `VibeRetryDecorator` covers OpenAI and Gemini in Node and the local WebLLM adapter in a browser build.

The wrapped function always returns a promise. Use `await` for both synchronous and asynchronous functions. A synchronous exception or a rejected promise starts the same decision process. Each retry uses the same arguments and receiver as the original call. Separate invocations each start with empty history.

When wrapping a free function with multiple TypeScript overloads, TypeScript infers the last overload. To select another declared signature, assign the function to a variable of that type or wrap a forwarding function such as `retry((id: string) => lookup(id))`. Runtime calls forward the arguments you supplied.

TypeScript also supports the standard `@retry`, `@retry()`, and `@retry({ … })` syntax on class methods that return a promise, including methods with an explicit `this` parameter. Omit or disable `experimentalDecorators`. For a free function, a synchronous method, or a function stored in a class field, use the wrapper form shown in the README. Here `retry` is an initialized `VibeRetry` instance.

```ts
class OrderService {
  constructor(private readonly orders: ReadonlyMap<number, string>) {}

  @retry({ max_retries: 2, remarks: "retry if the order may arrive shortly" })
  async getOrder(id: number): Promise<string> {
    const order = this.orders.get(id)
    if (order === undefined) throw new Error("Order is unavailable")
    return order
  }
}

const service = new OrderService(new Map([[7, "ready"]]))
const status = await service.getOrder(7)
```

### Retry decisions

| Wrapper option | Default | Behavior                                                                                                                                                                       |
| -------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `max_retries`  | `1`     | Maximum number of additional calls. Three permits up to four total calls. Zero or a negative integer makes one call with no model consultation. Use a JavaScript safe integer. |
| `remarks`      | `""`    | Guidance for the retry decision. OpenAI, Gemini, and WebLLM can also use it to choose a delay. |
| `probability_threshold` | `0.7` for Jev | A finite number from `0` through `1`. Jev approves another attempt when the estimate meets or exceeds this value. |

On failure with retries remaining, VibeRetry sends the function name, a text representation of its positional arguments, the exception type and message, the tail of the available stack trace (up to 4,000 characters), your remarks, and the history of previously approved attempts and their delays. The `args` field uses `util.inspect` in Node. Browser builds quote strings with JSON syntax, preserve bigint values, and label getters and circular references. Method calls forward `this` separately, so only explicitly passed arguments appear in `args`. The Python-compatible `kwargs` field contains `"{}"` because JavaScript passes arguments by position. An options object passed to your function remains an ordinary positional argument. Choose which arguments and error details to expose to the provider, and wrap operations that can safely be repeated.

OpenAI, Gemini, and WebLLM use the default system instruction requesting JSON such as `{"should_retry": true, "delay": 2}`. Both fields are required. `should_retry` must be a boolean. A positive integer `delay` waits that many **seconds** without blocking the event loop. A zero or negative delay retries immediately. The `timeout` covers evaluation only, and VibeRetry honors the full model-selected delay even if it lasts hours. As in Python, boolean delays correspond to `1` and `0`, and extra fields are discarded. Use an integer literal such as `1` for compatibility with Python. JavaScript also accepts `1.0` because it decodes to a safe integer, and rejects values outside the safe-integer range.

WebLLM constrains generated retry decisions to an object with a boolean `should_retry` and an integer `delay`. The default local prompt includes one example of a permanent failure and one of a transient failure. Supplying a custom system instruction or `null` omits those examples. Each decision uses the current failure and its own invocation's history. The adapter validates the reply and rejects incomplete generation even when its visible text looks like a complete decision.

Jev receives the failure as structured data and estimates whether another attempt is warranted. Omitting `probability_threshold` or passing `null` or `undefined` uses `0.7`. For example, `retry(fn, { probability_threshold: 0.8 })` approves a score of exactly `0.8`. At `0`, every valid Jev verdict approves a retry while retries remain. OpenAI, Gemini, and WebLLM reject a numeric threshold because they supply a retry decision directly. The Jev delay doubles from one second to a cap of 30 seconds. The sixth and all subsequent approved retries wait 30 seconds each.

To share one cutoff across functions, define `const retryRead = retry({ probability_threshold: 0.8 })` once and use `retryRead(fn)` with each function.

### Error handling

If the model declines or `max_retries` is exhausted, the wrapper rejects with the exact value thrown or rejected by the **last call**. A failure while evaluating the decision ends the operation immediately. A provider or parsing failure is available as the `cause` of an `Error`, and a timeout raises `VibeTimeoutException` directly. Import shared exception types from `@vibe-engineers/vibetools`.

### Configuration defaults

Pass a plain options object or a `VibeRetryConfig` instance as the third argument to `VibeRetry`. Using `null` or omitting the configuration selects the defaults below. As in Python, you can also supply an existing VibeTools `VibeConfig` instance. VibeRetry preserves that instance and its system instruction.

| Option               | Default                                                    | What it controls                                                                                                                                                                                          |
| -------------------- | ---------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `system_instruction` | JSON instruction for OpenAI, Gemini, and WebLLM | A custom instruction adds guidance to Jev's judgment. Pass `null` to clear the text instruction. |
| `timeout`            | `10_000` | Milliseconds for one model decision, including VibeTools' attempts to obtain it. The application function and the wait before its next call run outside that deadline. |
| `vibe_mode`          | `"chill"` | Case-insensitive. `CHILL` allows one attempt to obtain a model decision, `EAGER` two, and `AGGRESSIVE` three. VibeTools waits one second between attempts. |

VibeTools disables SDK retries for each Jev request. OpenAI and Gemini apply their SDK retry settings. `max_retries` caps the additional calls to the application function.

For example, given an initialized `client` and its `model`, allow a second attempt to obtain a decision within a five-second deadline.

```ts
import { VibeRetry } from "@vibe-engineers/viberetry"
import { VibeRetryConfig } from "@vibe-engineers/viberetry/config/config"

const config = new VibeRetryConfig({ timeout: 5_000, vibe_mode: "EAGER" })
const retry = VibeRetry(client, model, config)
```

### Logging

Set `VIBE_LOG_LEVEL` before starting Node. The shared logger defaults to `ERROR`. OpenAI and Gemini log provider selection at `INFO` and failure prompts and replies at `DEBUG`. Jev logs evaluation failures at `INFO`. For Jev request and response details, set the SDK's `TYPESAFE_LOG_LEVEL=debug`.

### Testing boundaries

The automated suites exercise the public wrapper and provider adapters with in-memory responses. They run without credentials. The standalone examples make authenticated provider requests. [Live examples](#live-examples)

## Code Documentation

Document public types with TypeScript signatures and use JSDoc for behavior a type cannot convey. When changing the retry options or the model prompt, update the examples and compatibility tests together.

## Testing

Run `npm run lint` and `npm test`. The test command builds VibeRetry, checks the public Node and browser declarations against the SDKs, and runs the offline tests. A browser-condition test loads the exported modules with Node built-ins and globals disabled. Use `npm pack --dry-run` to inspect which files npm will ship.

To compare against Python, activate a Python environment and run the commands below. When using `VIBE_PYTHON` instead of activating the environment, install the requirements with that interpreter. The combined checkout uses the sibling Python sources when present.

```sh
python -m pip install -r tests/parity/requirements.txt
npm run test:parity
```

## Pull Requests

Start a branch in your fork and keep each change focused. Include the affected API, the behavior before and after the change, and the checks you ran. For user-visible changes, update the examples or README in the same pull request. [Contribution guide](../CONTRIBUTING.md)

## Final Notes

Discuss larger changes with the maintainers before implementation. Documentation corrections can go directly into a pull request. [Community Discord](https://discord.gg/dBW35GBCPZ)
