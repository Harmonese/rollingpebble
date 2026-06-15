from __future__ import annotations

import importlib.metadata
import json
import os
import shlex
import shutil
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Protocol
from urllib.parse import urlparse

from rollingpebble.models import BatchRollRequest, RollRequest

PIPELINE_ORDER = ("s", "f", "t", "p", "a", "w")
PIPELINE_INDEX = {stage: index for index, stage in enumerate(PIPELINE_ORDER)}

ARTIFACTS_DIR_NAME = "artifacts"
VOCAL_AUDIO_NAME = "vocal.wav"
FILTERED_AUDIO_NAME = "filtered.wav"
TIMED_UNITS_NAME = "timed_units.json"
PARSED_LYRICS_NAME = "parsed_lyrics.json"
ALIGNMENT_RESULT_NAME = "alignment_result.json"


_PROXY_ENV_KEYS = (
    "HTTP_PROXY",
    "HTTPS_PROXY",
    "ALL_PROXY",
    "http_proxy",
    "https_proxy",
    "all_proxy",
)


def _proxy_can_be_exported_to_stdlib_env(proxy: str) -> bool:
    """Return whether the proxy is safe for stdlib urllib/torch.hub.

    Hugging Face downloads receive --transcriber-hf-proxy directly from
    py-roller, but Demucs uses torch.hub -> urllib.request for model
    downloads. urllib understands HTTP(S) proxy CONNECT, but it does not
    implement SOCKS. Exporting socks5/socks5h as HTTPS_PROXY makes urllib
    talk HTTP CONNECT to a SOCKS server, which fails with connection reset.
    """
    scheme = urlparse(proxy).scheme.lower()
    return scheme in {"http", "https"}


# Map rollingpebble UI language codes to py-roller PYROLLER_LANG locale codes.
# py-roller v0.6.0+ uses this env var to select its display language.
_UI_LANG_TO_PYROLLER_LANG: dict[str, str] = {
    "zh-CN": "zh",
    "zh-HK": "zh_Hant_HK",
    "zh-TW": "zh_Hant",
    "ja": "ja",
    "ko-KR": "ko",
    "pl-PL": "pl",
    "pt-BR": "pt",
    "sk-SK": "sk",
}


def build_pyroller_env(request: RollRequest, base_env: dict[str, str] | None = None) -> dict[str, str] | None:
    """Return subprocess environment overrides for py-roller downloads.

    py-roller accepts Hugging Face download options as CLI flags, but some
    backends and their dependencies also consult process-level environment
    variables. In particular Transformers / huggingface_hub based phoneme
    backends may open their own HTTP clients while resolving model assets.
    Exporting the same settings here keeps rollingpebble's UI proxy field
    effective for all py-roller transcriber backends.
    """
    stages = set(normalize_stages(request.stages))
    env = dict(base_env if base_env is not None else os.environ)
    changed = False

    if request.ui_lang:
        pyroller_lang = _UI_LANG_TO_PYROLLER_LANG.get(request.ui_lang)
        if pyroller_lang:
            env["PYROLLER_LANG"] = pyroller_lang
            changed = True

    if "t" not in stages:
        return env if changed else None

    proxy = str(request.transcriber_hf_proxy or "").strip()
    if proxy and _proxy_can_be_exported_to_stdlib_env(proxy):
        for key in _PROXY_ENV_KEYS:
            env[key] = proxy
        changed = True

    if request.transcriber_local_files_only:
        env["HF_HUB_OFFLINE"] = "1"
        env["TRANSFORMERS_OFFLINE"] = "1"
        changed = True

    if request.transcriber_hf_xet == "off":
        env["HF_HUB_DISABLE_XET"] = "1"
        changed = True
    elif request.transcriber_hf_xet == "on":
        env["HF_HUB_DISABLE_XET"] = "0"
        changed = True

    if request.transcriber_hf_etag_timeout is not None:
        env["HF_HUB_ETAG_TIMEOUT"] = str(request.transcriber_hf_etag_timeout)
        changed = True
    if request.transcriber_hf_download_timeout is not None:
        env["HF_HUB_DOWNLOAD_TIMEOUT"] = str(request.transcriber_hf_download_timeout)
        changed = True

    return env if changed else None


def dependency_status() -> tuple[bool, str | None, str | None]:
    cli = shutil.which("py-roller")
    version = None
    try:
        version = importlib.metadata.version("py-roller")
    except importlib.metadata.PackageNotFoundError:
        pass
    if cli is None:
        return False, version, "py-roller CLI not found on PATH"
    return True, version, cli


def cli_path() -> str | None:
    return shutil.which("py-roller")


def command_text(command: list[str]) -> str:
    return " ".join(shlex.quote(part) for part in command)


def default_model_store() -> Path:
    return Path.home() / ".cache" / "py-roller" / "models" / "transcriber"


def python_executable() -> str:
    return sys.executable


def default_artifacts_dir(project_root: Path) -> Path:
    return project_root / ARTIFACTS_DIR_NAME


def artifacts_for(project_root: Path) -> dict[str, Path]:
    root = default_artifacts_dir(project_root)
    return {
        "vocal_audio": root / VOCAL_AUDIO_NAME,
        "filtered_audio": root / FILTERED_AUDIO_NAME,
        "timed_units": root / TIMED_UNITS_NAME,
        "parsed_lyrics": root / PARSED_LYRICS_NAME,
        "alignment_result": root / ALIGNMENT_RESULT_NAME,
    }


def normalize_stages(stages: str | None) -> list[str]:
    items = [item.strip() for item in (stages or "s,f,t,p,a,w").split(",") if item.strip()]
    if not items:
        items = ["s", "f", "t", "p", "a", "w"]
    unknown = [stage for stage in items if stage not in PIPELINE_INDEX]
    if unknown:
        raise ValueError(f"Unknown py-roller stage(s): {', '.join(unknown)}")
    indexes = [PIPELINE_INDEX[stage] for stage in items]
    if indexes != list(range(indexes[0], indexes[0] + len(indexes))):
        raise ValueError(
            "py-roller stages must be a continuous subsequence of "
            f"{','.join(PIPELINE_ORDER)}; got {','.join(items)}"
        )
    return items


def normalized_stage_text(stages: str | None) -> str:
    return ",".join(normalize_stages(stages))


def _string_value(value: object | None) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    return text or None


def _set_if_present(target: dict[str, object], key: str, value: object | None) -> None:
    if value is not None and not (isinstance(value, str) and not value.strip()):
        target[key] = value


def _backend_config(request: RollRequest, *, default_model_store: Path | str | None = None) -> dict[str, object]:
    splitter: dict[str, object] = {"two_stems": "vocals"}
    _set_if_present(splitter, "backend", request.splitter_backend)
    _set_if_present(splitter, "model", request.splitter_demucs_model)
    _set_if_present(splitter, "device", request.splitter_demucs_device)
    _set_if_present(splitter, "jobs", request.splitter_demucs_jobs)
    _set_if_present(splitter, "overlap", request.splitter_demucs_overlap)
    _set_if_present(splitter, "segment", request.splitter_demucs_segment)

    filter_config: dict[str, object] = {}
    if _string_value(request.filter_chain):
        filter_config["chain"] = [item.strip() for item in str(request.filter_chain).split(",") if item.strip()]

    transcriber: dict[str, object] = {}
    _set_if_present(transcriber, "backend", request.transcriber_backend)
    _set_if_present(transcriber, "device", request.transcriber_device)
    _set_if_present(transcriber, "model_name", request.transcriber_model_name)
    model_path = request.transcriber_model_path or (str(default_model_store) if default_model_store else None)
    if _string_value(model_path):
        transcriber["model_path"] = str(Path(str(model_path)).expanduser())
    _set_if_present(transcriber, "local_files_only", request.transcriber_local_files_only)
    _set_if_present(transcriber, "compute_type", request.transcriber_compute_type)
    _set_if_present(transcriber, "batch_size", request.transcriber_batch_size)
    _set_if_present(transcriber, "vad_filter", request.transcriber_vad_filter)
    _set_if_present(transcriber, "hf_xet", request.transcriber_hf_xet)
    _set_if_present(transcriber, "hf_proxy", request.transcriber_hf_proxy)
    _set_if_present(transcriber, "hf_etag_timeout", request.transcriber_hf_etag_timeout)
    _set_if_present(transcriber, "hf_download_timeout", request.transcriber_hf_download_timeout)
    _set_if_present(transcriber, "hf_max_workers", request.transcriber_hf_max_workers)

    parser: dict[str, object] = {}
    _set_if_present(parser, "lyrics_encoding", request.parser_lyrics_encoding)

    aligner: dict[str, object] = {}
    _set_if_present(aligner, "backend", request.aligner_backend)
    _set_if_present(aligner, "min_gap", request.aligner_min_gap)
    _set_if_present(aligner, "repetition", request.aligner_repetition)

    writer: dict[str, object] = {}
    _set_if_present(writer, "backend", request.writer_backend)
    _set_if_present(writer, "spacing", request.writer_spacing)
    _set_if_present(writer, "by_tag", request.writer_by_tag)
    _set_if_present(writer, "tag_type", request.writer_ass_karaoke_tag_type)

    return {
        "splitter": splitter,
        "filter": filter_config,
        "parser": parser,
        "transcriber": transcriber,
        "aligner": aligner,
        "writer": writer,
    }


def _artifact_paths(artifacts_dir: Path | None, output_path: Path) -> dict[str, Path]:
    if artifacts_dir:
        return {
            "vocal_audio": artifacts_dir / VOCAL_AUDIO_NAME,
            "filtered_audio": artifacts_dir / FILTERED_AUDIO_NAME,
            "timed_units": artifacts_dir / TIMED_UNITS_NAME,
            "parsed_lyrics": artifacts_dir / PARSED_LYRICS_NAME,
            "alignment_result": artifacts_dir / ALIGNMENT_RESULT_NAME,
        }
    return artifacts_for(output_path.parent)


def build_pyroller_request(
    *,
    audio_path: Path,
    lyrics_path: Path,
    output_path: Path,
    intermediate_dir: Path,
    request: RollRequest,
    artifacts_dir: Path | None = None,
    default_model_store: Path | str | None = None,
) -> dict[str, object]:
    stages = normalize_stages(request.stages)
    stage_set = set(stages)
    first_stage = stages[0]
    artifacts = _artifact_paths(artifacts_dir, output_path)
    payload: dict[str, object] = {
        "protocol_version": 1,
        "request": {
            "stages": stages,
            "language": request.language,
            "cleanup": request.cleanup,
            "intermediate": str(intermediate_dir),
            "log_level": request.log_level,
            "backend_config": _backend_config(request, default_model_store=default_model_store),
        },
    }
    body = payload["request"]
    assert isinstance(body, dict)

    if stage_set.intersection({"s", "f", "t"}):
        body["audio"] = str(audio_path)
    if "p" in stage_set:
        body["lyrics"] = str(lyrics_path)
    if first_stage == "a":
        body["timed_units"] = str(artifacts["timed_units"])
        body["parsed_lyrics"] = str(artifacts["parsed_lyrics"])
    if first_stage == "w":
        body["alignment_result"] = str(artifacts["alignment_result"])
    if "w" in stage_set:
        body["output_roller"] = str(output_path)

    if "s" in stage_set:
        body["output_vocal_audio"] = str(artifacts["vocal_audio"])
    if "f" in stage_set:
        body["output_filtered_audio"] = str(artifacts["filtered_audio"])
    if "t" in stage_set:
        body["output_timed_units"] = str(artifacts["timed_units"])
    if "p" in stage_set:
        body["output_parsed_lyrics"] = str(artifacts["parsed_lyrics"])
    if "a" in stage_set:
        body["output_alignment_result"] = str(artifacts["alignment_result"])
    return payload


def build_pyroller_batch_request(
    request: BatchRollRequest,
    tasks: list[dict[str, str]],
    *,
    manifest_path: Path,
    intermediate_dir: Path,
    default_model_store: str | None = None,
) -> dict[str, object]:
    stages = normalize_stages(request.stages)
    return {
        "protocol_version": 1,
        "request": {
            "stages": stages,
            "language": request.language or "mul",
            "cleanup": request.cleanup or "on-success",
            "intermediate": str(intermediate_dir),
            "log_level": request.log_level or "INFO",
            "backend_config": _backend_config(request, default_model_store=default_model_store),
        },
        "batch": {
            "manifest": str(manifest_path),
            "continue_on_error": bool(getattr(request, "continue_on_error", False)),
            "skip_existing": bool(getattr(request, "skip_existing", False)),
            "jobs": int(getattr(request, "jobs", 1) or 1),
        },
    }


def ensure_private_work_dir(path: Path) -> Path:
    path.mkdir(parents=True, exist_ok=True)
    if os.name != "nt":
        path.chmod(0o700)
    return path


def write_protocol_request(payload: dict[str, object], directory: Path, *, filename: str = "request.json") -> tuple[Path, str]:
    text = json.dumps(payload, ensure_ascii=False, indent=2)
    directory = ensure_private_work_dir(directory)
    path = directory / filename
    flags = os.O_WRONLY | os.O_CREAT | os.O_TRUNC
    with os.fdopen(os.open(path, flags, 0o600), "w", encoding="utf-8") as file:
        file.write(text)
    if os.name != "nt":
        path.chmod(0o600)
    return path, text


class EngineProtocol(Protocol):
    def capabilities_command(self) -> list[str]:
        ...

    def run_command(self, request_path: Path) -> list[str]:
        ...

    def batch_command(self, request_path: Path) -> list[str]:
        ...


@dataclass(slots=True)
class PyRollerProtocolClient:
    command_prefix: list[str] | None = None

    def _prefix(self) -> list[str]:
        return self.command_prefix or ["py-roller"]

    def capabilities_command(self) -> list[str]:
        return [*self._prefix(), "capabilities", "--output-format", "json"]

    def run_command(self, request_path: Path) -> list[str]:
        return [
            *self._prefix(),
            "run",
            "--request",
            str(request_path),
            "--progress-format",
            "jsonl",
            "--output-format",
            "json",
        ]

    def batch_command(self, request_path: Path) -> list[str]:
        return [
            *self._prefix(),
            "batch",
            "--request",
            str(request_path),
            "--progress-format",
            "jsonl",
            "--output-format",
            "json",
        ]


def build_pyroller_command(
    *,
    audio_path: Path,
    lyrics_path: Path,
    output_path: Path,
    intermediate_dir: Path,
    request: RollRequest,
    artifacts_dir: Path | None = None,
    command_prefix: list[str] | None = None,
    default_model_store: Path | None = None,
    request_dir: Path,
) -> list[str]:
    payload = build_pyroller_request(
        audio_path=audio_path,
        lyrics_path=lyrics_path,
        output_path=output_path,
        intermediate_dir=intermediate_dir,
        artifacts_dir=artifacts_dir,
        request=request,
        default_model_store=default_model_store,
    )
    request_path, _text = write_protocol_request(payload, request_dir)
    return PyRollerProtocolClient(command_prefix=command_prefix).run_command(request_path)


def build_pyroller_batch_command(
    request: BatchRollRequest,
    tasks: list[dict[str, str]],
    *,
    request_dir: Path,
    default_model_store: str | None = None,
) -> tuple[list[str], str, str]:
    """Build a py-roller protocol v1 batch command and request JSON."""
    manifest_path, manifest_text = write_protocol_request({"tasks": tasks}, request_dir, filename="manifest.json")
    payload = build_pyroller_batch_request(
        request=request,
        tasks=tasks,
        manifest_path=manifest_path,
        intermediate_dir=request_dir / "intermediate",
        default_model_store=default_model_store,
    )
    request_path, request_text = write_protocol_request(payload, request_dir, filename="request.json")
    return PyRollerProtocolClient().batch_command(request_path), request_text, manifest_text
