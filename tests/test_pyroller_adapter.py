from pathlib import Path

import pytest

from rollingpebble.adapters.pyroller_adapter import build_pyroller_command, normalize_stages
from rollingpebble.models import RollRequest


def test_build_command_emits_integer_hf_timeouts_and_artifact_outputs() -> None:
    request = RollRequest(
        stages="t,p,a,w",
        language="zh",
        transcriber_backend="faster_whisper",
        transcriber_hf_etag_timeout=120,
        transcriber_hf_download_timeout=300,
        writer_backend="lrc_ms",
    )

    command = build_pyroller_command(
        audio_path=Path("/song/audio.mp3"),
        lyrics_path=Path("/song/plain.txt"),
        output_path=Path("/song/pyroller_output.lrc"),
        intermediate_dir=Path("/song/intermediate"),
        artifacts_dir=Path("/song/artifacts"),
        request=request,
    )

    assert command[command.index("--transcriber-hf-etag-timeout") + 1] == "120"
    assert command[command.index("--transcriber-hf-download-timeout") + 1] == "300"
    assert "120.0" not in command
    assert "--output-timed-units" in command
    assert "--output-parsed-lyrics" in command
    assert "--output-alignment-result" in command


def test_rewrite_command_uses_alignment_artifact_without_audio_or_lyrics() -> None:
    command = build_pyroller_command(
        audio_path=Path("/song/audio.mp3"),
        lyrics_path=Path("/song/plain.txt"),
        output_path=Path("/song/pyroller_output.lrc"),
        intermediate_dir=Path("/song/intermediate"),
        artifacts_dir=Path("/song/artifacts"),
        request=RollRequest(stages="w", writer_backend="lrc_ms"),
    )

    assert "--audio" not in command
    assert "--lyrics" not in command
    assert command[command.index("--alignment-result") + 1] == "/song/artifacts/alignment_result.json"


def test_stage_validation_rejects_non_continuous_pipeline() -> None:
    with pytest.raises(ValueError):
        normalize_stages("s,t,w")


def test_build_command_can_use_isolated_runtime_python_and_model_store() -> None:
    command = build_pyroller_command(
        audio_path=Path("/song/audio.mp3"),
        lyrics_path=Path("/song/plain.txt"),
        output_path=Path("/song/pyroller_output.lrc"),
        intermediate_dir=Path("/song/intermediate"),
        artifacts_dir=Path("/song/artifacts"),
        request=RollRequest(stages="t,p,a,w", writer_backend="lrc_ms"),
        command_prefix=["/runtime/bin/python", "-m", "pyroller.cli.main"],
        default_model_store=Path("/models/transcriber"),
    )

    assert command[:4] == ["/runtime/bin/python", "-m", "pyroller.cli.main", "run"]
    assert command[command.index("--transcriber-model-path") + 1] == "/models/transcriber"


def test_build_pyroller_env_does_not_export_socks_proxy_to_stdlib_env() -> None:
    request = RollRequest(
        stages="s,f,t,p,a,w",
        language="mul",
        transcriber_backend="wav2vec2_phoneme",
        transcriber_hf_proxy="socks5h://127.0.0.1:9909",
        transcriber_hf_xet="off",
        transcriber_hf_etag_timeout=30,
        transcriber_hf_download_timeout=120,
    )

    from rollingpebble.adapters.pyroller_adapter import build_pyroller_env

    env = build_pyroller_env(request, base_env={})

    assert env is not None
    for key in ("HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "http_proxy", "https_proxy", "all_proxy"):
        assert key not in env
    assert env["HF_HUB_DISABLE_XET"] == "1"
    assert env["HF_HUB_ETAG_TIMEOUT"] == "30"
    assert env["HF_HUB_DOWNLOAD_TIMEOUT"] == "120"


def test_build_pyroller_env_exports_http_proxy_to_stdlib_env() -> None:
    request = RollRequest(
        stages="s,f,t,p,a,w",
        transcriber_hf_proxy="http://127.0.0.1:7890",
    )

    from rollingpebble.adapters.pyroller_adapter import build_pyroller_env

    env = build_pyroller_env(request, base_env={})

    assert env is not None
    for key in ("HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "http_proxy", "https_proxy", "all_proxy"):
        assert env[key] == "http://127.0.0.1:7890"


def test_build_pyroller_env_ignores_non_transcriber_stage() -> None:
    from rollingpebble.adapters.pyroller_adapter import build_pyroller_env

    env = build_pyroller_env(
        RollRequest(stages="p,a,w", transcriber_hf_proxy="socks5h://127.0.0.1:9909"),
        base_env={},
    )

    assert env is None
