import json
import sys
from pathlib import Path

import pytest

from rollingpebble.adapters.pyroller_adapter import build_pyroller_batch_command, build_pyroller_command, normalize_stages
from rollingpebble.jobs_progress import parse_progress_line
from rollingpebble.models import BatchRollRequest, JobModel, JobStatus, RollRequest
from rollingpebble.runtime.reports import final_report_or_plain_json, protocol_status_ok, report_artifact_paths

PYROLLER_SOURCE = Path("/Users/xuzihao/Main/03 Developer Files/py-roller")


def _request_payload(command: list[str]) -> dict:
    path = Path(command[command.index("--request") + 1])
    return json.loads(path.read_text(encoding="utf-8"))


def _local_pyroller_protocol():
    if not PYROLLER_SOURCE.exists():
        pytest.skip(f"local py-roller source not found: {PYROLLER_SOURCE}")
    previous_modules = {name: module for name, module in sys.modules.items() if name == "pyroller" or name.startswith("pyroller.")}
    for name in previous_modules:
        sys.modules.pop(name, None)
    sys.path.insert(0, str(PYROLLER_SOURCE))
    try:
        import pyroller.protocol as protocol
    finally:
        try:
            sys.path.remove(str(PYROLLER_SOURCE))
        except ValueError:
            pass
    return protocol, previous_modules


def _restore_pyroller_modules(previous_modules: dict[str, object]) -> None:
    for name in list(sys.modules):
        if name == "pyroller" or name.startswith("pyroller."):
            sys.modules.pop(name, None)
    sys.modules.update(previous_modules)


def test_build_command_emits_protocol_request_with_artifact_outputs(tmp_path: Path) -> None:
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
        request_dir=tmp_path / "job",
    )
    payload = _request_payload(command)
    body = payload["request"]
    backend = body["backend_config"]["transcriber"]

    assert command[:2] == ["py-roller", "run"]
    assert "--request" in command
    assert "--output-format" in command
    assert payload["protocol_version"] == 1
    assert backend["hf_etag_timeout"] == 120
    assert backend["hf_download_timeout"] == 300
    assert body["output_timed_units"] == "/song/artifacts/timed_units.json"
    assert body["output_parsed_lyrics"] == "/song/artifacts/parsed_lyrics.json"
    assert body["output_alignment_result"] == "/song/artifacts/alignment_result.json"
    assert Path(command[command.index("--request") + 1]).parent == tmp_path / "job"


def test_rewrite_command_uses_alignment_artifact_without_audio_or_lyrics(tmp_path: Path) -> None:
    command = build_pyroller_command(
        audio_path=Path("/song/audio.mp3"),
        lyrics_path=Path("/song/plain.txt"),
        output_path=Path("/song/pyroller_output.lrc"),
        intermediate_dir=Path("/song/intermediate"),
        artifacts_dir=Path("/song/artifacts"),
        request=RollRequest(stages="w", writer_backend="lrc_ms"),
        request_dir=tmp_path / "job",
    )
    body = _request_payload(command)["request"]

    assert "audio" not in body
    assert "lyrics" not in body
    assert body["alignment_result"] == "/song/artifacts/alignment_result.json"


def test_stage_validation_rejects_non_continuous_pipeline() -> None:
    with pytest.raises(ValueError):
        normalize_stages("s,t,w")


def test_build_command_can_use_isolated_runtime_python_and_model_store(tmp_path: Path) -> None:
    command = build_pyroller_command(
        audio_path=Path("/song/audio.mp3"),
        lyrics_path=Path("/song/plain.txt"),
        output_path=Path("/song/pyroller_output.lrc"),
        intermediate_dir=Path("/song/intermediate"),
        artifacts_dir=Path("/song/artifacts"),
        request=RollRequest(stages="t,p,a,w", writer_backend="lrc_ms"),
        command_prefix=["/runtime/bin/python", "-m", "pyroller.cli.main"],
        default_model_store=Path("/models/transcriber"),
        request_dir=tmp_path / "job",
    )
    body = _request_payload(command)["request"]

    assert command[:4] == ["/runtime/bin/python", "-m", "pyroller.cli.main", "run"]
    assert body["backend_config"]["transcriber"]["model_path"] == "/models/transcriber"


def test_build_batch_command_can_use_isolated_runtime_model_store(tmp_path: Path) -> None:
    request_dir = tmp_path / "job"
    command, request_text, manifest_text = build_pyroller_batch_command(
        BatchRollRequest(stages="t,p,a,w", language="zh", writer_backend="lrc_ms", project_ids=["one"]),
        [{"id": "one", "audio": "/song/audio.mp3", "lyrics": "/song/plain.txt", "output_roller": "/song/out.lrc"}],
        request_dir=request_dir,
        default_model_store="/models/transcriber",
    )
    payload = json.loads(request_text)
    body = payload["request"]
    manifest = json.loads(manifest_text)

    assert command[:2] == ["py-roller", "batch"]
    assert body["backend_config"]["transcriber"]["model_path"] == "/models/transcriber"
    assert "audio" not in body
    assert "lyrics" not in body
    assert "output_roller" not in body
    assert payload["batch"]["manifest"] == str(request_dir / "manifest.json")
    assert manifest["tasks"][0]["id"] == "one"
    assert Path(command[command.index("--request") + 1]) == request_dir / "request.json"


def test_generated_run_request_is_accepted_by_local_pyroller_protocol(tmp_path: Path) -> None:
    command = build_pyroller_command(
        audio_path=Path("/song/audio.mp3"),
        lyrics_path=Path("/song/plain.txt"),
        output_path=Path("/song/pyroller_output.lrc"),
        intermediate_dir=Path("/song/intermediate"),
        artifacts_dir=Path("/song/artifacts"),
        request=RollRequest(stages="t,p,a,w", language="zh", writer_backend="lrc_ms"),
        request_dir=tmp_path / "job",
    )
    payload = _request_payload(command)
    protocol, previous_modules = _local_pyroller_protocol()
    try:
        parsed = protocol.pipeline_request_from_dict(payload)
        report = protocol.protocol_envelope(
            "run_result",
            artifact_paths={"roller": str(parsed.output_roller_path)},
        )
    finally:
        _restore_pyroller_modules(previous_modules)

    assert parsed.stages == ["t", "p", "a", "w"]
    assert parsed.language == "zh"
    assert parsed.output_roller_path == Path("/song/pyroller_output.lrc")
    assert report["schema_version"] == 1
    assert report["protocol_version"] == 1
    assert report["engine"] == "py-roller"
    assert report["type"] == "run_result"
    assert report["status"] == "ok"
    assert report_artifact_paths(report)["roller"] == "/song/pyroller_output.lrc"


def test_generated_batch_request_is_accepted_by_local_pyroller_protocol(tmp_path: Path) -> None:
    request_dir = tmp_path / "job"
    command, request_text, manifest_text = build_pyroller_batch_command(
        BatchRollRequest(stages="p,a,w", language="mul", writer_backend="lrc_ms", project_ids=["one"], continue_on_error=True),
        [{"id": "one", "lyrics": "/song/plain.txt", "output_roller": "/song/out.lrc"}],
        request_dir=request_dir,
        default_model_store="/models/transcriber",
    )
    protocol, previous_modules = _local_pyroller_protocol()
    try:
        parsed = protocol.batch_request_from_json(Path(command[command.index("--request") + 1]))
    finally:
        _restore_pyroller_modules(previous_modules)

    manifest = json.loads(manifest_text)
    assert json.loads(request_text)["protocol_version"] == 1
    assert parsed.request.stages == ["p", "a", "w"]
    assert parsed.request.language == "mul"
    assert parsed.options.manifest == request_dir / "manifest.json"
    assert parsed.options.continue_on_error is True
    assert manifest["tasks"][0]["output_roller"] == "/song/out.lrc"


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


def test_progress_parser_accepts_only_protocol_v1_events() -> None:
    progress = parse_progress_line(
        'PYROLLER_EVENT {"schema_version": 1, "type": "stage_progress", "stage": "writer", '
        '"message": "writing", "progress": 0.5, "timestamp": "2026-01-01T00:00:00Z"}'
    )

    assert progress is not None
    assert progress.stage == "writer"
    assert progress.message == "writing"
    assert progress.progress == 0.5
    assert parse_progress_line("pyroller.progress | writer [1/2 step] - old text") is None
    assert parse_progress_line('PYROLLER_EVENT {"type": "stage_progress", "stage": "writer"}') is None


def test_protocol_report_helpers_parse_final_json_from_logs() -> None:
    job = JobModel(
        job_id="job_run",
        kind="auto_timing",
        status=JobStatus.running,
        logs=[
            "human line",
            "{",
            '  "schema_version": 1,',
            '  "engine": "py-roller",',
            '  "engine_version": "0.8.1",',
            '  "protocol_version": 1,',
            '  "type": "run_result",',
            '  "status": "ok",',
            '  "artifact_paths": {"roller": "/song/out.lrc"}',
            "}",
        ],
    )

    report = final_report_or_plain_json(job, report_type="run_result")

    assert report is not None
    assert protocol_status_ok(report)
    assert report_artifact_paths(report)["roller"] == "/song/out.lrc"


def test_protocol_report_helpers_prefer_last_json_block() -> None:
    job = JobModel(
        job_id="job_cache",
        kind="runtime-cache-model",
        status=JobStatus.running,
        logs=[
            '{"ok": false, "message": "subprocess probe"}',
            "{",
            '  "schema_version": 1,',
            '  "engine": "py-roller",',
            '  "engine_version": "0.8.1",',
            '  "protocol_version": 1,',
            '  "type": "cache_model_result",',
            '  "status": "ok",',
            '  "artifact_paths": {"model_dir": "/models/current"}',
            "}",
        ],
    )

    report = final_report_or_plain_json(job, report_type="cache_model_result")

    assert report is not None
    assert report["type"] == "cache_model_result"
    assert report_artifact_paths(report)["model_dir"] == "/models/current"


def test_protocol_report_helpers_ignore_wrong_protocol_type() -> None:
    job = JobModel(
        job_id="job_run",
        kind="auto_timing",
        status=JobStatus.running,
        logs=[
            "{",
            '  "schema_version": 1,',
            '  "engine": "py-roller",',
            '  "engine_version": "0.8.1",',
            '  "protocol_version": 1,',
            '  "type": "doctor_result",',
            '  "status": "ok",',
            '  "artifact_paths": {}',
            "}",
        ],
    )

    assert final_report_or_plain_json(job, report_type="run_result") is None
