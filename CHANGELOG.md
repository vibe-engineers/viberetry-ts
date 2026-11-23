# Changelog

## 0.1.1

- Added WebLLM retry decisions for application-owned main-thread and worker engines through the existing package root and `./viberetry` entry points. Both use the shared retry loop, decision validation, and delays in seconds.
- Added local examples of a permanent and a transient failure to the default WebLLM retry instruction, plus constrained JSON generation for the retry decision.

## 0.1.0

- Added optional Jev retry judgments with a per-operation `probability_threshold` (default `>= 0.7`) and exponential waits capped at 30 seconds.
- Ported the VibeRetry callable, retry prompt, configurable retry limit, decision history, second-based delays, and error propagation from Python.
- Added public callable types so consuming libraries can export configured instances in their TypeScript declarations.
- Added promise-based wrappers for synchronous and asynchronous functions and standard TypeScript decorators for promise-returning methods, including methods with an explicit `this` parameter.
- Added OpenAI and Google Gemini examples and offline tests comparing the TypeScript behavior with Python.
