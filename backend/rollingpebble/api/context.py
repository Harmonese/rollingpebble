from __future__ import annotations

from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from pathlib import Path
import platform
import subprocess
from typing import TypeVar

from fastapi import HTTPException

from rollingpebble.config import Settings
from rollingpebble.jobs import JobManager
from rollingpebble.messages import message_from_exception, message_from_text
from rollingpebble.services.lrclib_service import LrclibService
from rollingpebble.services.netease_service import NeteaseService
from rollingpebble.services.project_service import ProjectService
from rollingpebble.services.roller_service import RollerService
from rollingpebble.runtime.service import RuntimeService
from rollingpebble.services.storage_service import StorageService
from rollingpebble.services.upload_service import UploadService

T = TypeVar("T")


@dataclass(slots=True)
class AppServices:
    settings: Settings
    jobs: JobManager
    projects: ProjectService
    lrclib: LrclibService
    netease: NeteaseService
    runtime: RuntimeService
    roller: RollerService
    upload: UploadService
    storage: StorageService
    apply_storage_layout: Callable[[], None]


def error_detail(exc: Exception, *, default_code: str = "system.error") -> dict:
    return message_from_exception(exc, default_code=default_code).model_dump()


def text_detail(text: str, *, default_code: str = "system.error") -> dict:
    return message_from_text(text, default_code=default_code).model_dump()


def raise_http_error(
    status_code: int,
    exc: Exception,
    *,
    default_code: str = "system.error",
) -> None:
    raise HTTPException(
        status_code=status_code,
        detail=error_detail(exc, default_code=default_code),
    ) from exc


def service_call(
    action: Callable[[], T],
    *,
    not_found: tuple[type[Exception], ...] = (FileNotFoundError,),
    default_status: int = 400,
    default_code: str = "system.error",
) -> T:
    try:
        return action()
    except HTTPException:
        raise
    except not_found as exc:
        raise_http_error(404, exc, default_code=default_code)
    except Exception as exc:
        raise_http_error(default_status, exc, default_code=default_code)


async def async_service_call(
    action: Callable[[], Awaitable[T]],
    *,
    not_found: tuple[type[Exception], ...] = (FileNotFoundError,),
    default_status: int = 400,
    default_code: str = "system.error",
) -> T:
    try:
        return await action()
    except HTTPException:
        raise
    except not_found as exc:
        raise_http_error(404, exc, default_code=default_code)
    except Exception as exc:
        raise_http_error(default_status, exc, default_code=default_code)


def open_folder(folder: Path) -> dict[str, str]:
    try:
        system = platform.system().lower()
        if system == "darwin":
            subprocess.Popen(["open", str(folder)])
        elif system == "windows":
            subprocess.Popen(["explorer", str(folder)])
        else:
            subprocess.Popen(["xdg-open", str(folder)])
        return {"status": "ok", "path": str(folder)}
    except Exception as exc:
        raise HTTPException(
            status_code=400,
            detail=text_detail(
                f"Could not open folder: {exc}",
                default_code="system.open_folder_failed",
            ),
        ) from exc
