from __future__ import annotations

from pathlib import Path
import os

from rollingpebble.jobs import JobManager
from rollingpebble.messages import message_from_text
from rollingpebble.models import (
    AutoRollerRuntimeResponse,
    RuntimeSettingsModel,
    RuntimeSettingsUpdateRequest,
)
from rollingpebble.paths import StorageLayout
from rollingpebble.runtime.constants import PYROLLER_RUNTIME_SPEC
from rollingpebble.runtime.manager import RuntimeManager
from rollingpebble.runtime.settings import RuntimeSettingsService
from rollingpebble.runtime.preparation import RuntimePreparation


class RuntimeService:
    def __init__(
        self,
        *,
        data_dir: Path | None = None,
        layout: StorageLayout | None = None,
        jobs: JobManager,
        manager: RuntimeManager | None = None,
    ) -> None:
        if layout is None and data_dir is None:
            raise ValueError("RuntimeService requires data_dir or layout")
        if layout is None:
            assert data_dir is not None
            layout = StorageLayout.from_data_dir(data_dir)
        self.layout = layout
        self.data_dir = self.layout.app_root
        self.manager = manager or RuntimeManager(self.layout)
        self.preparation = RuntimePreparation(self.manager, jobs)
        self.settings = RuntimeSettingsService(self.data_dir)
        self.settings_store = self.settings.store
        from rollingpebble.auto_timing.model_service import ModelService
        self.models = ModelService(self, jobs)

    def update_layout(self, layout: StorageLayout) -> None:
        self.layout = layout
        self.data_dir = layout.app_root
        self.settings.update_data_dir(self.data_dir)
        self.settings_store = self.settings.store
        self.manager.update_layout(layout)

    def get_auto_roller_runtime(self) -> AutoRollerRuntimeResponse:
        settings = self.settings.read()
        runtime = self.manager.active_runtime(settings)
        return AutoRollerRuntimeResponse(
            startup_preparation=bool(os.environ.get("ROLLINGPEBBLE_APP_RESOURCES")),
            preparation=self.preparation.snapshot(),
            available=runtime.ready,
            version=runtime.version,
            cli_path=" ".join(self.manager.command_prefix(settings.auto_roller_profile)) if runtime.ready else None,
            python_executable=runtime.python_path.as_posix() if runtime.python_path else "",
            data_dir=str(self.data_dir),
            model_store=str(self.manager.default_model_store()),
            settings=settings,
            detail=runtime.detail,
            detail_message=message_from_text(runtime.detail) if runtime.detail else None,
            runtime_id=runtime.runtime_id,
            runtime_status=runtime.status,
            runtime_profile=runtime.profile,
            runtime_root=str(runtime.runtime_root),
            runtime_venv=str(runtime.venv_path),
            runtime_python=str(runtime.python_path),
            runtime_source=runtime.source,
            runtime_requirement=PYROLLER_RUNTIME_SPEC,
            doctor_report=runtime.doctor_report,
            install_report=runtime.install_report,
        )

    def get_settings(self) -> RuntimeSettingsModel:
        return self.settings.read()

    def update_settings(self, request: RuntimeSettingsUpdateRequest) -> RuntimeSettingsModel:
        return self.settings.update(request)

    def reset_settings_defaults(self) -> RuntimeSettingsModel:
        return self.settings.reset_defaults()
