"""Language boundary for the pinned engine; display text is never normalized here."""
from __future__ import annotations

import json
import subprocess

LANGUAGES = ("auto", "en", "zh", "zh-en", "mul")
CTC_KINDS = {"en": "ctc", "zh": "ctc-zh", "zh-en": "ctc-zh", "mul": "ctc-mul"}
MODEL_PATH_KEYS = {"whisper": "whisper_model", "ctc": "ctc_model",
                   "ctc-zh": "ctc_zh_model", "ctc-mul": "ctc_mul_model"}
MODEL_LANGUAGES = {"ctc": "en", "ctc-zh": "zh", "ctc-mul": "mul"}


def resolve_language(python, text, requested, env):
    # This single adapter is deliberately tied to the bundled engine version.
    script = ("import json,sys; from pyroller.language import resolve_language; "
              "text,requested=json.load(sys.stdin); print(json.dumps(resolve_language(text,requested)))")
    result = subprocess.run([str(python), "-c", script], input=json.dumps([text, requested]),
                            capture_output=True, text=True, env=env, timeout=30)
    if result.returncode:
        raise ValueError("Auto Timing could not resolve the lyric language")
    language = json.loads(result.stdout)
    if language not in CTC_KINDS:
        raise ValueError("Unsupported resolved lyric language")
    return language


def engine_options(options, language):
    result = dict(options, language=language)
    kind = CTC_KINDS[language]
    result.pop("ctc_model", None)
    if path := options.get(MODEL_PATH_KEYS[kind]):
        result["ctc_model"] = path
    for key in ("ctc_zh_model", "ctc_mul_model"):
        result.pop(key, None)
    return result


def required_models(options):
    if options.get("language") not in CTC_KINDS:
        from rollingpebble.messages import AppError
        raise AppError("timing.language", "Resolve lyric language before checking models.")
    result = [] if options.get("whisper_model") else ["whisper"]
    if not options.get("ctc_model"):
        result.append(CTC_KINDS[options["language"]])
    if options.get("audio_mode") == "vocals":
        result.append("demucs")
    return result
