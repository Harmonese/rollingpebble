from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from rollingpebble.cli import _settings_env
from rollingpebble.config import Settings, resolve_frontend_dist
from rollingpebble.main import create_app
from rollingpebble import job_kinds
from rollingpebble.models import JobModel, JobStatus, RuntimeInstallRequest
from rollingpebble.runtime.service import RuntimeService


class FakeJobs:
    def __init__(self, jobs: list[JobModel]) -> None:
        self._jobs = jobs

    def list(self) -> list[JobModel]:
        return self._jobs


class FakeCreateJobs(FakeJobs):
    def __init__(self) -> None:
        super().__init__([])
        self.created: dict[str, object] | None = None

    def create_subprocess_job(self, **kwargs: object) -> JobModel:
        self.created = kwargs
        return JobModel(job_id="job_cache", kind=str(kwargs["kind"]), status=JobStatus.queued, command=kwargs["command"])


def test_explicit_frontend_dist_is_served(tmp_path: Path) -> None:
    dist = tmp_path / "dist"
    dist.mkdir()
    (dist / "index.html").write_text("<!doctype html><title>rollingpebble</title>", encoding="utf-8")

    assert resolve_frontend_dist(Settings(data_dir=tmp_path, frontend_dist=dist)) == dist

    app = create_app(Settings(data_dir=tmp_path / "data", frontend_dist=dist))
    response = TestClient(app).get("/")

    assert response.status_code == 200
    assert "rollingpebble" in response.text


def test_cli_settings_env_forwards_data_dir(tmp_path: Path) -> None:
    env = _settings_env(Settings(host="127.0.0.1", port=6790, data_dir=tmp_path))

    assert env["LRC_ROLLER_HOST"] == "127.0.0.1"
    assert env["LRC_ROLLER_PORT"] == "6790"
    assert env["LRC_ROLLER_DATA_DIR"] == str(tmp_path)


def test_runtime_install_blocks_concurrent_runtime_work(tmp_path: Path) -> None:
    service = RuntimeService(
        data_dir=tmp_path,
        jobs=FakeJobs([JobModel(job_id="job_install", kind=job_kinds.RUNTIME_INSTALL, status=JobStatus.running)]),
    )

    with pytest.raises(RuntimeError, match="already running"):
        service.run_install(RuntimeInstallRequest(profile="auto"))


def test_runtime_doctor_blocks_install_in_progress(tmp_path: Path) -> None:
    service = RuntimeService(
        data_dir=tmp_path,
        jobs=FakeJobs([JobModel(job_id="job_install", kind=job_kinds.RUNTIME_INSTALL, status=JobStatus.running)]),
    )

    with pytest.raises(RuntimeError, match="runtime job is already running"):
        service.run_doctor()


def test_runtime_install_module_installs_socks_support_package(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    from rollingpebble.runtime import installer

    runtime_python = installer.select_runtime_python()
    venv = tmp_path / "envs" / installer._runtime_id("auto", runtime_python.tag) / ".venv"
    python = installer._venv_python(venv)
    python.parent.mkdir(parents=True)
    python.write_text("", encoding="utf-8")

    commands: list[list[str]] = []

    def fake_run(command: list[str], *, env: dict[str, str] | None = None) -> None:
        commands.append(command)

    def fake_run_json(command: list[str], *, env: dict[str, str] | None = None) -> dict:
        commands.append(command)
        return {"ok": True}

    monkeypatch.setattr(installer, "_run", fake_run)
    monkeypatch.setattr(installer, "_run_json", fake_run_json)
    monkeypatch.setattr(installer, "_pyroller_version", lambda python, env: "0.5.6")

    installer.install_runtime(tmp_path, "auto", skip_doctor=True)

    assert any("py-roller>=0.8.2,<0.9" in command for command in commands)
    assert any("PySocks>=1.7.1" in command for command in commands)


def test_runtime_install_recreates_incomplete_managed_venv(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    from rollingpebble.runtime import installer

    runtime_python = installer.select_runtime_python()
    venv = tmp_path / "envs" / installer._runtime_id("auto", runtime_python.tag) / ".venv"
    broken_marker = venv / "bin" / "python3.12"
    broken_marker.parent.mkdir(parents=True)
    broken_marker.symlink_to(tmp_path / "missing-python3.12")

    commands: list[list[str]] = []

    def fake_run(command: list[str], *, env: dict[str, str] | None = None) -> None:
        commands.append(command)
        if command[:3] == [runtime_python.executable, "-m", "venv"]:
            python = installer._venv_python(venv)
            python.parent.mkdir(parents=True, exist_ok=True)
            python.write_text("", encoding="utf-8")

    def fake_run_json(command: list[str], *, env: dict[str, str] | None = None) -> dict:
        commands.append(command)
        return {"ok": True}

    monkeypatch.setattr(installer, "_run", fake_run)
    monkeypatch.setattr(installer, "_run_json", fake_run_json)
    monkeypatch.setattr(installer, "_pyroller_version", lambda python, env: "0.8.2")

    installer.install_runtime(tmp_path, "auto", skip_doctor=True)

    assert not broken_marker.exists()
    assert any(command[:3] == [runtime_python.executable, "-m", "venv"] for command in commands)


def test_runtime_dependency_recipe_keeps_pyroller_and_support_specs_together() -> None:
    from rollingpebble.runtime.recipe import DEFAULT_RUNTIME_RECIPE

    commands = DEFAULT_RUNTIME_RECIPE.dependency_install_commands(Path("/runtime/.venv/bin/python"))

    assert any("py-roller>=0.8.2,<0.9" in command for command in commands)
    assert any("PySocks>=1.7.1" in command for command in commands)


def test_runtime_env_uses_allowlist_and_keeps_managed_paths(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    from rollingpebble.runtime.environment import build_runtime_env

    monkeypatch.setenv("SECRET_TOKEN", "do-not-leak")
    monkeypatch.setenv("AWS_ACCESS_KEY_ID", "do-not-leak")
    monkeypatch.setenv("LANG", "zh_CN.UTF-8")
    monkeypatch.setenv("LRC_ROLLER_PYROLLER_SOURCE", "../py-roller")

    venv = tmp_path / "envs" / "runtime" / ".venv"
    env = build_runtime_env(venv, tmp_path)
    dev_env = build_runtime_env(venv, tmp_path, include_dev=True)

    assert "SECRET_TOKEN" not in env
    assert "AWS_ACCESS_KEY_ID" not in env
    assert env["LANG"] == "zh_CN.UTF-8"
    assert "LRC_ROLLER_PYROLLER_SOURCE" not in env
    assert dev_env["LRC_ROLLER_PYROLLER_SOURCE"] == "../py-roller"
    assert env["PIP_CACHE_DIR"] == str(tmp_path / "cache" / "pip")
    assert env["HF_HOME"] == str(tmp_path / "models" / "transcriber" / "providers" / "huggingface")


def test_runtime_dependency_upgrade_runner_uses_recipe(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    from rollingpebble.runtime import dependencies

    venv = tmp_path / "envs" / "runtime" / ".venv"
    python = dependencies.runtime_python_path(venv)
    python.parent.mkdir(parents=True)
    python.write_text("", encoding="utf-8")
    commands: list[list[str]] = []

    def fake_run(command: list[str], *, env: dict[str, str]) -> None:
        commands.append(command)

    monkeypatch.setattr(dependencies, "_run", fake_run)

    dependencies.upgrade_dependencies(tmp_path, venv)

    assert any("py-roller>=0.8.2,<0.9" in command for command in commands)
    assert any("PySocks>=1.7.1" in command for command in commands)


def test_runtime_manager_cache_model_command_defaults_to_managed_model_store(tmp_path: Path) -> None:
    from rollingpebble.runtime.manager import RuntimeManager

    manager = RuntimeManager(tmp_path)
    python_path = manager.python_path("auto")
    python_path.parent.mkdir(parents=True, exist_ok=True)
    python_path.write_text("", encoding="utf-8")
    manager.update_metadata("auto", {"pyroller_version": "0.8.0", "last_doctor_status": "passed"})

    command = manager.cache_model_command(
        "auto",
        language="zh",
        backend="faster_whisper",
        model_name="large-v2",
        hf_xet="off",
        hf_download_timeout=300,
    )

    assert command[:4] == [str(python_path), "-m", "pyroller.cli.main", "cache-model"]
    assert command[command.index("--output-format") + 1] == "json"
    assert command[command.index("--transcriber-model-path") + 1] == str(tmp_path / "models" / "transcriber")
    assert command[command.index("--transcriber-hf-xet") + 1] == "off"
    assert command[command.index("--transcriber-hf-download-timeout") + 1] == "300"


def test_runtime_cache_model_uses_managed_model_store_and_download_settings(tmp_path: Path) -> None:
    from rollingpebble.models import ModelCacheRequest, RuntimeSettingsModel
    from rollingpebble.runtime.manager import IsolatedRuntimeInfo

    class FakeRuntimeManager:
        def __init__(self) -> None:
            self.command_kwargs: dict[str, object] | None = None

        def active_runtime(self, settings: RuntimeSettingsModel) -> IsolatedRuntimeInfo:
            python_path = tmp_path / "envs" / "pyroller-test" / ".venv" / "bin" / "python"
            python_path.parent.mkdir(parents=True, exist_ok=True)
            python_path.write_text("", encoding="utf-8")
            return IsolatedRuntimeInfo(
                runtime_id="pyroller-test",
                profile=settings.auto_roller_profile,
                status="ready",
                runtime_root=tmp_path / "envs" / "pyroller-test",
                venv_path=tmp_path / "envs" / "pyroller-test" / ".venv",
                python_path=python_path,
                version="0.8.0",
            )

        def default_model_store(self) -> Path:
            return tmp_path / "models" / "transcriber"

        def runtime_env(self, venv: Path) -> dict[str, str]:
            return {"VIRTUAL_ENV": str(venv)}

        def cache_model_command(self, profile: str, **kwargs: object) -> list[str]:
            self.command_kwargs = {"profile": profile, **kwargs}
            command = ["python", "-m", "pyroller.cli.main", "cache-model"]
            model_path = kwargs.get("model_path") or str(self.default_model_store())
            command.extend(["--transcriber-model-path", str(model_path)])
            if kwargs.get("hf_xet"):
                command.extend(["--transcriber-hf-xet", str(kwargs["hf_xet"])])
            if kwargs.get("hf_proxy"):
                command.extend(["--transcriber-hf-proxy", str(kwargs["hf_proxy"])])
            if kwargs.get("hf_download_timeout") is not None:
                command.extend(["--transcriber-hf-download-timeout", str(kwargs["hf_download_timeout"])])
            return command

    jobs = FakeCreateJobs()
    manager = FakeRuntimeManager()
    service = RuntimeService(data_dir=tmp_path, jobs=jobs, manager=manager)
    settings = RuntimeSettingsModel(
        auto_timing_hf_xet="off",
        auto_timing_hf_proxy="http://127.0.0.1:7890",
        auto_timing_hf_download_timeout=300,
    )
    service.settings_store.write(settings)

    service.run_cache_model(ModelCacheRequest(language="zh"))

    assert jobs.created is not None
    command = jobs.created["command"]
    assert isinstance(command, list)
    assert command[command.index("--transcriber-model-path") + 1] == str(tmp_path / "models" / "transcriber")
    assert command[command.index("--transcriber-hf-xet") + 1] == "off"
    assert command[command.index("--transcriber-hf-proxy") + 1] == "http://127.0.0.1:7890"
    assert command[command.index("--transcriber-hf-download-timeout") + 1] == "300"


def test_cache_model_result_uses_protocol_report() -> None:
    from rollingpebble.runtime.results import RuntimeResultStore

    job = JobModel(
        job_id="job_cache",
        kind=job_kinds.RUNTIME_CACHE_MODEL,
        status=JobStatus.running,
        logs=[
            "human prelude",
            "{",
            '  "schema_version": 1,',
            '  "engine": "py-roller",',
            '  "engine_version": "0.8.1",',
            '  "protocol_version": 1,',
            '  "type": "cache_model_result",',
            '  "status": "ok",',
            '  "artifact_paths": {"model_dir": "/models/faster-whisper-large-v2"},',
            '  "backend": "faster_whisper",',
            '  "language": "zh",',
            '  "effective_model_name": "large-v2",',
            '  "resolved_model_dir": "/models/faster-whisper-large-v2",',
            '  "model_store_root": "/models"',
            "}",
        ],
    )

    result = RuntimeResultStore.cache_model_result(job, succeeded=True)

    assert result["succeeded"] is True
    assert result["model_dir"] == "/models/faster-whisper-large-v2"
    assert result["backend"] == "faster_whisper"
    assert result["language"] == "zh"
    assert result["effective_model_name"] == "large-v2"


def test_netease_audio_endpoint_streams_same_origin_audio(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    from rollingpebble.services.netease_service import NeteaseService

    captured: dict[str, object] = {}

    class FakeHeaders(dict):
        def get_content_type(self) -> str:
            return str(self.get("Content-Type", "audio/mpeg"))

    class FakeUpstream:
        status = 206

        def __init__(self) -> None:
            self.headers = FakeHeaders(
                {
                    "Content-Type": "audio/mpeg",
                    "Content-Length": "4",
                    "Content-Range": "bytes 0-3/10",
                    "Accept-Ranges": "bytes",
                }
            )
            self._chunks = [b"data", b""]
            self.closed = False

        def read(self, _size: int) -> bytes:
            return self._chunks.pop(0)

        def close(self) -> None:
            self.closed = True

    def fake_open_audio(self: NeteaseService, song_id: int, *, range_header: str | None = None, timeout: float = 20.0):
        captured["song_id"] = song_id
        captured["range_header"] = range_header
        return FakeUpstream()

    monkeypatch.setattr(NeteaseService, "open_audio", fake_open_audio)

    response = TestClient(create_app(Settings(data_dir=tmp_path))).get(
        "/api/netease/audio/3350769226",
        headers={"Range": "bytes=0-3"},
    )

    assert response.status_code == 206
    assert response.content == b"data"
    assert response.headers["content-type"].startswith("audio/mpeg")
    assert response.headers["content-range"] == "bytes 0-3/10"
    assert captured == {"song_id": 3350769226, "range_header": "bytes=0-3"}


def test_api_routes_are_registered_by_domain_modules(tmp_path: Path) -> None:
    routes = {getattr(route, "path", "") for route in create_app(Settings(data_dir=tmp_path)).routes}

    assert "/api/health" in routes
    assert "/api/projects" in routes
    assert "/api/projects/{project_id}/roll" in routes
    assert "/api/runtime/auto-roller/install" in routes
    assert "/api/storage/cleanup/preview" in routes
    assert "/api/netease/audio/{song_id}" in routes


def test_openapi_keeps_frontend_shared_api_contract(tmp_path: Path) -> None:
    client = TestClient(create_app(Settings(data_dir=tmp_path)))
    openapi = client.get("/openapi.json").json()
    paths = openapi["paths"]
    schemas = openapi["components"]["schemas"]

    expected_routes = {
        "/api/health": {"get"},
        "/api/settings": {"get", "post"},
        "/api/settings/reset-defaults": {"post"},
        "/api/settings/workspace-bg": {"get", "post", "delete"},
        "/api/settings/workspace-bg/status": {"get"},
        "/api/local/select-path": {"post"},
        "/api/projects": {"get", "post"},
        "/api/projects/{project_id}": {"get", "delete"},
        "/api/projects/{project_id}/audio": {"get"},
        "/api/projects/{project_id}/open-folder": {"post"},
        "/api/projects/{project_id}/lyrics": {"post"},
        "/api/projects/{project_id}/editor": {"post"},
        "/api/projects/{project_id}/roll/preview": {"post"},
        "/api/projects/{project_id}/roll": {"post"},
        "/api/batch/preview": {"post"},
        "/api/batch/roll": {"post"},
        "/api/jobs/{job_id}": {"get"},
        "/api/jobs/{job_id}/cancel": {"post"},
        "/api/jobs/{job_id}/open-folder": {"post"},
        "/api/runtime/auto-roller": {"get"},
        "/api/runtime/auto-roller/doctor": {"post"},
        "/api/runtime/auto-roller/install": {"post"},
        "/api/runtime/auto-roller/upgrade": {"post"},
        "/api/runtime/auto-roller/cache-model": {"post"},
        "/api/storage/usage": {"get"},
        "/api/storage/cleanup/preview": {"post"},
        "/api/storage/cleanup/run": {"post"},
        "/api/storage/migrate-root": {"post"},
        "/api/storage/open-folder": {"post"},
        "/api/storage/projects/open-folder": {"post"},
        "/api/storage/models/open-folder": {"post"},
        "/api/storage/runtimes/open-folder": {"post"},
        "/api/storage/other/open-folder": {"post"},
        "/api/projects/{project_id}/upload/plan": {"post"},
        "/api/projects/{project_id}/upload/run": {"post"},
        "/api/lrclib/search": {"post"},
        "/api/lrclib/get": {"post"},
        "/api/lrclib/id": {"post"},
        "/api/netease/search": {"post"},
        "/api/netease/resolve": {"post"},
        "/api/netease/lyrics/{song_id}": {"get"},
        "/api/netease/audio/{song_id}": {"get"},
    }
    for path, methods in expected_routes.items():
        assert path in paths
        assert methods <= set(paths[path])

    def assert_response_ref(path: str, method: str, schema_name: str) -> None:
        schema = paths[path][method]["responses"]["200"]["content"]["application/json"]["schema"]
        if "$ref" in schema:
            assert schema["$ref"] == f"#/components/schemas/{schema_name}"
            return
        assert schema.get("items", {}).get("$ref") == f"#/components/schemas/{schema_name}"

    assert_response_ref("/api/settings", "get", "RuntimeSettingsModel")
    assert_response_ref("/api/projects", "get", "ProjectModel")
    assert_response_ref("/api/projects/{project_id}/roll/preview", "post", "RollPreviewResponse")
    assert_response_ref("/api/projects/{project_id}/roll", "post", "JobModel")
    assert_response_ref("/api/batch/roll", "post", "JobModel")
    assert_response_ref("/api/jobs/{job_id}", "get", "JobModel")
    assert_response_ref("/api/runtime/auto-roller", "get", "AutoRollerRuntimeResponse")
    assert_response_ref("/api/storage/usage", "get", "StorageUsageResponse")
    assert_response_ref("/api/storage/cleanup/preview", "post", "StorageCleanupPlanResponse")
    assert_response_ref("/api/storage/cleanup/run", "post", "StorageCleanupRunResponse")
    assert_response_ref("/api/projects/{project_id}/upload/plan", "post", "UploadPlanResponse")
    assert_response_ref("/api/projects/{project_id}/upload/run", "post", "UploadRunResponse")

    expected_fields = {
        "RuntimeSettingsModel": {
            "auto_timing_default_language",
            "auto_timing_transcriber_backend",
            "auto_timing_model_store",
            "storage_projects_root",
            "recent_projects_limit",
        },
        "ProjectModel": {"project_id", "audio_ref", "audio_path", "metadata", "plain_lyrics", "synced_lyrics"},
        "JobModel": {"job_id", "kind", "status", "command", "logs", "progress", "result", "error"},
        "AutoRollerRuntimeResponse": {"engine", "runtime_status", "settings", "model_store", "python_executable"},
        "RollPreviewResponse": {"command", "command_text", "warnings", "warning_messages", "output_path"},
        "StorageUsageResponse": {"data_dir", "roots", "categories", "projects", "models", "runtimes", "other_items"},
        "UploadPlanResponse": {"can_upload", "mode", "reason", "plain_lines", "synced_lines", "payload_preview"},
    }
    for schema_name, fields in expected_fields.items():
        assert fields <= set(schemas[schema_name]["properties"])


def test_api_errors_include_i18n_message_descriptor(tmp_path: Path) -> None:
    client = TestClient(create_app(Settings(data_dir=tmp_path)))

    project_response = client.get("/api/projects/missing-project")
    assert project_response.status_code == 404
    project_detail = project_response.json()["detail"]
    assert project_detail["code"] == "project.not_found"
    assert project_detail["params"]["project_id"] == "missing-project"
    assert project_detail["fallback"] == "Project not found: missing-project"

    job_response = client.get("/api/jobs/missing-job")
    assert job_response.status_code == 404
    job_detail = job_response.json()["detail"]
    assert job_detail["code"] == "job.not_found"
    assert job_detail["params"]["job_id"] == "missing-job"


def test_command_exit_message_descriptor_keeps_exit_code_param() -> None:
    from rollingpebble.messages import message_from_text

    message = message_from_text("Command exited with code 1")

    assert message.code == "job.command_exited"
    assert message.params == {"code": "1"}
    assert message.fallback == "Command exited with code 1"


def test_runtime_ready_message_descriptor_keeps_runtime_id_param() -> None:
    from rollingpebble.messages import message_from_text

    message = message_from_text("Runtime ready: pyroller-py312-auto")

    assert message.code == "runtime.ready_with_id"
    assert message.params == {"id": "pyroller-py312-auto"}
    assert message.fallback == "Runtime ready: pyroller-py312-auto"


def test_settings_reset_defaults_preserves_runtime_history(tmp_path: Path) -> None:
    from rollingpebble.models import RuntimeSettingsModel
    from rollingpebble.storage.app_settings import SettingsStore

    store = SettingsStore(tmp_path)
    store.write(
        RuntimeSettingsModel(
            auto_roller_profile="cu124",
            auto_fill_lyrics_library_from_project_metadata=False,
            auto_timing_default_language="en",
            auto_timing_transcriber_backend="mms_phonetic",
            auto_timing_hf_proxy="socks5h://127.0.0.1:9909",
            recent_projects_limit=3,
            last_doctor_status="passed",
            last_doctor_at="2026-05-14T00:00:00+00:00",
            last_install_profile="cu124",
            last_install_at="2026-05-14T00:01:00+00:00",
            last_install_status="passed",
        )
    )
    client = TestClient(create_app(Settings(data_dir=tmp_path)))

    response = client.post("/api/settings/reset-defaults")

    assert response.status_code == 200
    payload = response.json()
    assert payload["auto_roller_profile"] == "auto"
    assert payload["auto_fill_lyrics_library_from_project_metadata"] is True
    assert payload["auto_timing_default_language"] == "zh"
    assert payload["auto_timing_transcriber_backend"] == "faster_whisper"
    assert payload["auto_timing_hf_proxy"] == ""
    assert payload["recent_projects_limit"] == 8
    assert payload["last_doctor_status"] == "passed"
    assert payload["last_doctor_at"] == "2026-05-14T00:00:00+00:00"
    assert payload["last_install_profile"] == "cu124"
    assert payload["last_install_at"] == "2026-05-14T00:01:00+00:00"
    assert payload["last_install_status"] == "passed"
