from __future__ import annotations

import importlib.metadata
import shlex
import shutil
import sys
from pathlib import Path

from lrc_roller.models import RollRequest


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


def build_pyroller_command(
    *,
    audio_path: Path,
    lyrics_path: Path,
    output_path: Path,
    intermediate_dir: Path,
    request: RollRequest,
) -> list[str]:
    command = [
        "py-roller",
        "run",
        "--stages",
        request.stages,
        "--audio",
        str(audio_path),
        "--lyrics",
        str(lyrics_path),
        "--output-roller",
        str(output_path),
        "--language",
        request.language,
        "--writer-spacing",
        request.writer_spacing,
        "--cleanup",
        request.cleanup,
        "--intermediate",
        str(intermediate_dir),
        "--log-level",
        request.log_level,
    ]

    if request.splitter_backend:
        command.extend(["--splitter-backend", request.splitter_backend])
    if request.splitter_demucs_model:
        command.extend(["--splitter-demucs-model", request.splitter_demucs_model])
    if request.splitter_demucs_device:
        command.extend(["--splitter-demucs-device", request.splitter_demucs_device])
    if request.splitter_demucs_jobs is not None:
        command.extend(["--splitter-demucs-jobs", str(request.splitter_demucs_jobs)])
    if request.splitter_demucs_overlap is not None:
        command.extend(["--splitter-demucs-overlap", str(request.splitter_demucs_overlap)])
    if request.splitter_demucs_segment is not None:
        command.extend(["--splitter-demucs-segment", str(request.splitter_demucs_segment)])

    if request.filter_chain:
        command.extend(["--filter-chain", request.filter_chain])

    if request.transcriber_backend:
        command.extend(["--transcriber-backend", request.transcriber_backend])
    if request.transcriber_device:
        command.extend(["--transcriber-device", request.transcriber_device])
    if request.transcriber_model_name:
        command.extend(["--transcriber-model-name", request.transcriber_model_name])
    if request.transcriber_model_path:
        model_path = Path(request.transcriber_model_path).expanduser()
        command.extend(["--transcriber-model-path", str(model_path)])
    if request.transcriber_local_files_only:
        command.append("--transcriber-local-files-only")
    if request.transcriber_compute_type:
        command.extend(["--transcriber-compute-type", request.transcriber_compute_type])
    if request.transcriber_batch_size is not None:
        command.extend(["--transcriber-batch-size", str(request.transcriber_batch_size)])
    if request.transcriber_hf_xet:
        command.extend(["--transcriber-hf-xet", request.transcriber_hf_xet])
    if request.transcriber_hf_proxy:
        command.extend(["--transcriber-hf-proxy", request.transcriber_hf_proxy])
    if request.transcriber_hf_etag_timeout is not None:
        command.extend(["--transcriber-hf-etag-timeout", str(request.transcriber_hf_etag_timeout)])
    if request.transcriber_hf_download_timeout is not None:
        command.extend(["--transcriber-hf-download-timeout", str(request.transcriber_hf_download_timeout)])
    if request.transcriber_hf_max_workers is not None:
        command.extend(["--transcriber-hf-max-workers", str(request.transcriber_hf_max_workers)])

    if request.parser_lyrics_encoding:
        command.extend(["--parser-lyrics-encoding", request.parser_lyrics_encoding])

    if request.aligner_backend:
        command.extend(["--aligner-backend", request.aligner_backend])
    if request.aligner_min_gap is not None:
        command.extend(["--aligner-min-gap", str(request.aligner_min_gap)])
    if request.aligner_repetition:
        command.extend(["--aligner-repetition", request.aligner_repetition])

    if request.writer_backend:
        command.extend(["--writer-backend", request.writer_backend])
    if request.writer_by_tag:
        command.extend(["--writer-by-tag", request.writer_by_tag])
    if request.writer_ass_karaoke_tag_type:
        command.extend(["--writer-ass-karaoke-tag-type", request.writer_ass_karaoke_tag_type])
    return command
