from __future__ import annotations

from fastapi import FastAPI

from rollingpebble.api.context import AppServices
from rollingpebble.api.health import create_health_router
from rollingpebble.api.jobs import create_jobs_router
from rollingpebble.api.lyrics_sources import create_lyrics_sources_router
from rollingpebble.api.projects import create_projects_router
from rollingpebble.api.roller import create_roller_router
from rollingpebble.api.runtime import create_runtime_router
from rollingpebble.api.settings import create_settings_router
from rollingpebble.api.storage import create_storage_router
from rollingpebble.api.upload import create_upload_router


def include_api_routes(app: FastAPI, services: AppServices) -> None:
    app.include_router(create_health_router(services))
    app.include_router(create_projects_router(services))
    app.include_router(create_lyrics_sources_router(services))
    app.include_router(create_roller_router(services))
    app.include_router(create_jobs_router(services))
    app.include_router(create_settings_router(services))
    app.include_router(create_runtime_router(services))
    app.include_router(create_upload_router(services))
    app.include_router(create_storage_router(services))
