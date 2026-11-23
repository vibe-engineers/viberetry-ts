import {
  isPlainObject,
  VibeConfig,
  type VibeConfigOptions,
} from "@vibe-engineers/vibetools/_internal/vibe_config"

export const defaultRetryInstruction =
  "You are a function. Return ONLY a valid JSON STRING, with no code fences, " +
  "no markdown formatting, and no explanations. It must have EXACTLY two keys:\n" +
  '  "should_retry": a boolean (true or false)\n' +
  '  "delay": an integer number of seconds\n' +
  "Do not include any text before or after the JSON. Output must look like:\n" +
  '{"should_retry": false, "delay": 0}'

/** Shared evaluation settings with the default instruction for retry decisions. */
export class VibeRetryConfig extends VibeConfig {
  constructor(options: VibeConfigOptions = {}) {
    if (!isPlainObject(options))
      throw new TypeError("VibeRetryConfig options must be a plain object.")
    const { system_instruction = defaultRetryInstruction, ...settings } = options
    super({ ...settings, system_instruction })
    if (new.target === VibeRetryConfig) Object.freeze(this)
  }
}
