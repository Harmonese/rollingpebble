from __future__ import annotations

import importlib.metadata
import shlex
import shutil
import sys
from pathlib import Path

from lrc_roller.models import RollRequest

PIPELINE_ORDER = ("s", "f", "t", "p", "a", "w")
PIPELINE_INDEX = {stage: index for index, stage in enumerate(PIPELINE_ORDER)}

ARTIFACTS_DIR_NAME = "artifacts"
VOCAL_AUDIO_NAME = "vocal.wav"
FILTERED_AUDIO_NAME = "filtered.wav"
TIMED_UNITS_NAME = "timed_units.json"
PARSED_LYRICS_NAME = "parsed_lyrics.json"
ALIGNMENT_RESULT_NAME = "alignment_result.json"


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
    items = [item.strip() for item in (stages or "t,p,a,w").split(",") if item.strip()]
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
        "py-roller",
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
        if request.transcriber_model_path:
            model_path = Path(request.transcriber_model_path).expanduser()
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
