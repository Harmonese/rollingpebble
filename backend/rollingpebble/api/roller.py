from fastapi import APIRouter, HTTPException


def create_roller_router(services) -> APIRouter:
    router = APIRouter()

    @router.post("/api/projects/{project_id}/roll/preview")
    @router.post("/api/projects/{project_id}/roll")
    @router.post("/api/batch/preview")
    @router.post("/api/batch/roll")
    def unsupported():
        raise HTTPException(410, "Protocol v1 was removed. Use /api/auto-timing/runs.")

    return router
