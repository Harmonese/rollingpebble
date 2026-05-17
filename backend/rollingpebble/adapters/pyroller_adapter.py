from __future__ import annotations

import importlib.metadata
import os
import shlex
import shutil
import sys
import tempfile
from pathlib import Path
from urllib.parse import urlparse

import yaml

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
    detail = None
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


def _add_option(command: list[str], name: str, value: object | None) -> None:
    if value is not None and not (isinstance(value, str) and not value.strip()):
        command.extend([name, str(value)])


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
) -> list[str]:
    stages = normalize_stages(request.stages)
    stage_set = set(stages)
    first_stage = stages[0]
    artifacts = artifacts_for(artifacts_dir.parent) if artifacts_dir else artifacts_for(output_path.parent)
    if artifacts_dir:
        artifacts = {
            "vocal_audio": artifacts_dir / VOCAL_AUDIO_NAME,
            "filtered_audio": artifacts_dir / FILTERED_AUDIO_NAME,
            "timed_units": artifacts_dir / TIMED_UNITS_NAME,
            "parsed_lyrics": artifacts_dir / PARSED_LYRICS_NAME,
            "alignment_result": artifacts_dir / ALIGNMENT_RESULT_NAME,
        }

    command = [
        *(command_prefix or ["py-roller"]),
        "run",
        "--stages",
        ",".join(stages),
        "--language",
        request.language,
        "--cleanup",
        request.cleanup,
        "--intermediate",
        str(intermediate_dir),
        "--log-level",
        request.log_level,
        "--progress-format",
        "jsonl",
    ]

    if stage_set.intersection({"s", "f", "t"}):
        command.extend(["--audio", str(audio_path)])
    if "p" in stage_set:
        command.extend(["--lyrics", str(lyrics_path)])
    if first_stage == "a":
        command.extend(["--timed-units", str(artifacts["timed_units"])])
        command.extend(["--parsed-lyrics", str(artifacts["parsed_lyrics"])])
    if first_stage == "w":
        command.extend(["--alignment-result", str(artifacts["alignment_result"])])
    if "w" in stage_set:
        command.extend(["--output-roller", str(output_path)])

    if "s" in stage_set:
        _add_option(command, "--splitter-backend", request.splitter_backend)
        _add_option(command, "--splitter-demucs-model", request.splitter_demucs_model)
        _add_option(command, "--splitter-demucs-device", request.splitter_demucs_device)
        _add_option(command, "--splitter-demucs-jobs", request.splitter_demucs_jobs)
        _add_option(command, "--splitter-demucs-overlap", request.splitter_demucs_overlap)
        _add_option(command, "--splitter-demucs-segment", request.splitter_demucs_segment)
        command.extend(["--output-vocal-audio", str(artifacts["vocal_audio"])])

    if "f" in stage_set:
        _add_option(command, "--filter-chain", request.filter_chain)
        command.extend(["--output-filtered-audio", str(artifacts["filtered_audio"])])

    if "t" in stage_set:
        _add_option(command, "--transcriber-backend", request.transcriber_backend)
        _add_option(command, "--transcriber-device", request.transcriber_device)
        _add_option(command, "--transcriber-model-name", request.transcriber_model_name)
        model_path_value = request.transcriber_model_path or (str(default_model_store) if default_model_store else "")
        if model_path_value:
            model_path = Path(model_path_value).expanduser()
            command.extend(["--transcriber-model-path", str(model_path)])
        if request.transcriber_local_files_only:
            command.append("--transcriber-local-files-only")
        _add_option(command, "--transcriber-compute-type", request.transcriber_compute_type)
        _add_option(command, "--transcriber-batch-size", request.transcriber_batch_size)
        _add_option(command, "--transcriber-hf-xet", request.transcriber_hf_xet)
        _add_option(command, "--transcriber-hf-proxy", request.transcriber_hf_proxy)
        _add_option(command, "--transcriber-hf-etag-timeout", request.transcriber_hf_etag_timeout)
        _add_option(command, "--transcriber-hf-download-timeout", request.transcriber_hf_download_timeout)
        _add_option(command, "--transcriber-hf-max-workers", request.transcriber_hf_max_workers)
        if request.transcriber_vad_filter:
            command.append("--transcriber-vad-filter")
        command.extend(["--output-timed-units", str(artifacts["timed_units"])])

    if "p" in stage_set:
        _add_option(command, "--parser-lyrics-encoding", request.parser_lyrics_encoding)
        command.extend(["--output-parsed-lyrics", str(artifacts["parsed_lyrics"])])

    if "a" in stage_set:
        _add_option(command, "--aligner-backend", request.aligner_backend)
        _add_option(command, "--aligner-min-gap", request.aligner_min_gap)
        _add_option(command, "--aligner-repetition", request.aligner_repetition)
        command.extend(["--output-alignment-result", str(artifacts["alignment_result"])])

    if "w" in stage_set:
        _add_option(command, "--writer-backend", request.writer_backend)
        _add_option(command, "--writer-spacing", request.writer_spacing)
        _add_option(command, "--writer-by-tag", request.writer_by_tag)
        _add_option(command, "--writer-ass-karaoke-tag-type", request.writer_ass_karaoke_tag_type)
    return command


def build_pyroller_batch_command(
    request: BatchRollRequest,
    tasks: list[dict[str, str]],
    *,
    default_model_store: str | None = None,
) -> tuple[list[str], str]:
    """Build a py-roller batch command with a YAML manifest.

    Returns (command, manifest_yaml_text) so callers can log the manifest.
    """
    manifest = {"tasks": tasks}
    manifest_text = yaml.safe_dump(manifest, default_flow_style=False, allow_unicode=True,
                                   sort_keys=False)

    # Write manifest to a temp file alongside the first project's intermediate dir
    # so it lives in the rollingpebble data directory.
    tmp = tempfile.NamedTemporaryFile(mode="w", suffix=".yaml", prefix="batch_manifest_",
                                      delete=False, encoding="utf-8")
    tmp.write(manifest_text)
    tmp.close()
    manifest_path = tmp.name

    stage_set = set(normalize_stages(request.stages or "s,f,t,p,a,w"))
    command = ["py-roller", "batch", "--manifest", manifest_path,
               "--progress-format", "jsonl",
               "--stages", ",".join(sorted(stage_set, key=lambda s: PIPELINE_INDEX.get(s, 99))),
               "--language", request.language or "zh",
               "--cleanup", request.cleanup or "on-success",
               "--log-level", request.log_level or "INFO"]

    if request.continue_on_error:
        command.append("--continue-on-error")
    if request.skip_existing:
        command.append("--skip-existing")

    if "s" in stage_set:
        _add_option(command, "--splitter-backend", request.splitter_backend)
        _add_option(command, "--splitter-demucs-model", request.splitter_demucs_model)
        _add_option(command, "--splitter-demucs-device", request.splitter_demucs_device)
        _add_option(command, "--splitter-demucs-jobs", request.splitter_demucs_jobs)
        _add_option(command, "--splitter-demucs-overlap", request.splitter_demucs_overlap)
        _add_option(command, "--splitter-demucs-segment", request.splitter_demucs_segment)

    if "f" in stage_set:
        _add_option(command, "--filter-chain", request.filter_chain)

    if "t" in stage_set:
        _add_option(command, "--transcriber-backend", request.transcriber_backend)
        _add_option(command, "--transcriber-device", request.transcriber_device)
        _add_option(command, "--transcriber-model-name", request.transcriber_model_name)
        model_path_value = request.transcriber_model_path or (str(default_model_store) if default_model_store else "")
        if model_path_value:
            command.extend(["--transcriber-model-path", str(Path(model_path_value).expanduser())])
        if request.transcriber_local_files_only:
            command.append("--transcriber-local-files-only")
        if request.transcriber_vad_filter:
            command.append("--transcriber-vad-filter")
        _add_option(command, "--transcriber-compute-type", request.transcriber_compute_type)
        _add_option(command, "--transcriber-batch-size", request.transcriber_batch_size)
        _add_option(command, "--transcriber-hf-xet", request.transcriber_hf_xet)
        _add_option(command, "--transcriber-hf-proxy", request.transcriber_hf_proxy)
        _add_option(command, "--transcriber-hf-etag-timeout", request.transcriber_hf_etag_timeout)
        _add_option(command, "--transcriber-hf-download-timeout", request.transcriber_hf_download_timeout)
        _add_option(command, "--transcriber-hf-max-workers", request.transcriber_hf_max_workers)

    if "p" in stage_set:
        _add_option(command, "--parser-lyrics-encoding", request.parser_lyrics_encoding)

    if "a" in stage_set:
        _add_option(command, "--aligner-backend", request.aligner_backend)
        _add_option(command, "--aligner-min-gap", request.aligner_min_gap)
        _add_option(command, "--aligner-repetition", request.aligner_repetition)

    if "w" in stage_set:
        _add_option(command, "--writer-backend", request.writer_backend)
        _add_option(command, "--writer-spacing", request.writer_spacing)
        _add_option(command, "--writer-by-tag", request.writer_by_tag)
        _add_option(command, "--writer-ass-karaoke-tag-type", request.writer_ass_karaoke_tag_type)

    return command, manifest_text
