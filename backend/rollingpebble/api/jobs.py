from __future__ import annotations

from fastapi import APIRouter, HTTPException

from rollingpebble.api.context import AppServices, open_folder, raise_http_error, text_detail
from rollingpebble.models import JobModel


def create_jobs_router(services: AppServices) -> APIRouter:
    router = APIRouter()

    @router.post("/api/jobs/{job_id}/cancel", response_model=JobModel)
    def cancel_job(job_id: str) -> JobModel:
        try:
            return services.jobs.cancel(job_id)
        except KeyError as exc:
            raise HTTPException(status_code=404, detail=text_detail(f"Job not found: {job_id}")) from exc

    @router.post("/api/jobs/{job_id}/open-folder")
    def open_job_folder(job_id: str) -> dict[str, str]:
        try:
            job = services.jobs.get(job_id)
        except KeyError as exc:
            raise HTTPException(status_code=404, detail=text_detail(f"Job not found: {job_id}")) from exc
        if not job.project_id:
            raise HTTPException(
                status_code=400,
                detail=text_detail("This job is not attached to a project folder."),
            )
        try:
            folder = services.projects.project_folder(job.project_id)
        except FileNotFoundError as exc:
            raise_http_error(404, exc)
        return open_folder(folder)

    @router.get("/api/jobs/{job_id}", response_model=JobModel)
    def get_job(job_id: str) -> JobModel:
        try:
            return services.jobs.get(job_id)
        except KeyError as exc:
            raise HTTPException(status_code=404, detail=text_detail(f"Job not found: {job_id}")) from exc

    return router
