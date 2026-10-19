import sys
from fastapi import APIRouter, Depends, HTTPException, Request

from rollingpebble.api.context import service_call
from rollingpebble.translation import ConnectionUpdate, TranslationRequest


def create_translation_router(services):
    def origin(request: Request):
        if request.url.hostname not in {"127.0.0.1", "localhost", "::1", services.settings.host}:
            raise HTTPException(403, detail={"code": "translation.origin"})
        supplied = request.headers.get("origin")
        allowed = {str(request.base_url).rstrip("/")}
        if not getattr(sys, "frozen", False):
            allowed.update({"http://127.0.0.1:5173", "http://localhost:5173"})
        if request.headers.get("sec-fetch-site") == "cross-site" or (supplied and supplied not in allowed):
            raise HTTPException(403, detail={"code": "translation.origin"})
        if request.method != "GET" and request.headers.get("x-rollingpebble-client") != "translation":
            raise HTTPException(403, detail={"code": "translation.origin"})

    router = APIRouter(prefix="/api/translation", dependencies=[Depends(origin)])
    service = services.translation

    @router.get("/connection")
    def connection():
        return service_call(service.report)

    @router.put("/connection")
    def configure(body: ConnectionUpdate):
        return service_call(lambda: service.configure(body))

    @router.post("/jobs")
    async def start(body: TranslationRequest):
        return service_call(lambda: service.start(body))

    @router.post("/test")
    async def test(body: TranslationRequest):
        return service_call(lambda: service.start(body, test=True))

    @router.get("/jobs/{ident}")
    async def get(ident: str):
        if ident not in service.jobs:
            raise HTTPException(404, detail={"code": "translation.expired"})
        return service.jobs[ident]

    @router.post("/jobs/{ident}/cancel")
    async def cancel(ident: str):
        if ident not in service.jobs:
            raise HTTPException(404, detail={"code": "translation.expired"})
        return await service.cancel(ident)

    return router
