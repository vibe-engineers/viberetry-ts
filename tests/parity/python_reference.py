"""Run the Python retry loop against the Node suite's scripted targets and SDK replies."""

import json
import sys
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock, patch

# A standalone checkout uses the pinned packages installed in the selected
# interpreter. In the combined workspace, exercise the Python working copies.
repository = Path(__file__).resolve().parents[2]
python_packages = repository.parent.parent / "python"
sources = [python_packages / name / "src" for name in ("viberetry", "vibetools")]
if all(source.is_dir() for source in sources):
    sys.path[:0] = [str(source) for source in sources]

from google import genai
from openai import OpenAI
from viberetry import VibeRetry
from viberetry.config.config import VibeRetryConfig


def run_case(provider, case):
    events = []
    replies = iter(case["replies"])

    def answer(model, instruction, prompt):
        events.append(["consult", model, instruction, prompt])
        reply = next(replies)
        if reply is None:
            raise RuntimeError("offline provider failure")
        return reply

    if provider == "openai":
        def create(*, model, instructions, input):
            return SimpleNamespace(output_text=answer(model, instructions, input))

        sdk = Mock(spec=OpenAI)
        sdk.responses = SimpleNamespace(create=create)
    else:
        def generate_content(*, model, contents, config):
            return SimpleNamespace(text=answer(model, config["system_instruction"], contents))

        sdk = Mock(spec=genai.Client)
        sdk.models = SimpleNamespace(generate_content=generate_content)

    config = case.get("config")
    if case.get("config_instance"):
        config = VibeRetryConfig(**config)
    retry = VibeRetry(sdk, "offline-model", config=config)
    errors = []

    def operation(*args):
        events.append(["call", list(args)])
        if len(errors) < len(case["failures"]):
            error = TypeError(case["failures"][len(errors)])
            errors.append(error)
            raise error
        return case.get("value", "ok")

    options = case.get("options", {})
    if case.get("form") == "bare":
        wrapped = retry(operation)
    elif case.get("form") == "direct":
        wrapped = retry(operation, **options)
    else:
        wrapped = retry(**options)(operation)

    outcomes = []
    # VibeTools and VibeRetry both use time.sleep. Keeping an ordered log lets
    # the caller distinguish provider re-evaluations from target retries.
    with patch("time.sleep", side_effect=lambda seconds: events.append(["wait", seconds])):
        for _ in range(case.get("runs", 1)):
            errors.clear()
            try:
                outcomes.append({"value": wrapped(*case.get("args", []))})
            except Exception as error:
                for index, target_error in enumerate(errors):
                    if error is target_error:
                        outcomes.append({"target_error": index})
                        break
                else:
                    cause = error.__cause__
                    outcomes.append({"error": type(cause or error).__name__, "wrapped": cause is not None})
    return {"events": events, "outcomes": outcomes}


if __name__ == "__main__":
    cases = json.load(sys.stdin)
    with patch("socket.socket.connect", side_effect=AssertionError("Unexpected network transport")):
        results = {
            provider: [run_case(provider, case) for case in cases]
            for provider in ("openai", "gemini")
        }
    print(json.dumps(results, allow_nan=False))
