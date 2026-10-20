import shutil

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse

from rollingpebble.api.context import service_call
from rollingpebble.auto_timing.contracts import AppliedRequest, BatchRequest, DraftUpdate, ModelAction, RunRequest
from rollingpebble.auto_timing.service import audio_identity
from rollingpebble.auto_timing.store import ACTIVE, now
from rollingpebble.storage.files import resolve_audio_path


def create_auto_timing_router(services):
    router = APIRouter(prefix="/api/auto-timing")
    service = services.auto_timing

    @router.post("/preflight")
    def preflight(request: RunRequest):
        return service_call(lambda: service.preflight(request))

    @router.post("/runs")
    def start(request: RunRequest):
        return service_call(lambda: service.start(request))

    @router.post("/runs/{run_id}/retry")
    def retry_run(run_id: str, request: RunRequest):
        def retry():
            old = service.store.get(run_id)
            if old["status"] in ACTIVE or old["kind"] != "run" or old["project_id"] != request.project_id:
                raise ValueError("Run cannot be retried in this workspace")
            request.options = old["options"]
            request.options = RunRequest(project_id=request.project_id, options=request.options).options
            return service.start(request, language=old["language"])
        return service_call(retry)

    @router.get("/runs")
    def history(project_id: str | None = None):
        return [{k: v for k, v in r.items() if k not in {"snapshot", "progress"}} for r in service.store.list(project_id)]

    @router.get("/runs/{run_id}")
    def get(run_id: str):
        return service_call(lambda: service.store.get(run_id))

    @router.post("/runs/{run_id}/cancel")
    def cancel(run_id: str):
        return service_call(lambda: service.cancel(run_id))

    @router.get("/runs/{run_id}/draft")
    def draft(run_id: str):
        return service_call(lambda: service.store.draft(run_id))

    @router.put("/runs/{run_id}/draft")
    def save_draft(run_id: str, request: DraftUpdate):
        try:
            return service.store.save_draft(run_id, request)
        except FileExistsError as exc:
            raise HTTPException(409, str(exc)) from exc
        except FileNotFoundError as exc:
            raise HTTPException(404, str(exc)) from exc
        except ValueError as exc:
            raise HTTPException(400, str(exc)) from exc

    @router.get("/runs/{run_id}/binding")
    def binding(run_id: str):
        def check():
            run = service.store.get(run_id)
            project = services.projects.get(run["project_id"])
            path = resolve_audio_path(services.projects.projects_root, project)
            return {"matches": bool(path and audio_identity(path) == run["audio_identity"])}
        return service_call(check)

    @router.post("/runs/{run_id}/applied")
    def applied(run_id: str, request: AppliedRequest):
        def record():
            with service.store.lock:
                run = service.store.get(run_id)
                if run["status"] in ACTIVE:
                    raise ValueError("Run is still active")
                if service.store.draft(run_id)["version"] != request.version:
                    raise ValueError("Draft changed")
                return service.store.update(run_id, applied=[*run["applied"], {"at": now(), "version": request.version}])
        return service_call(record)

    @router.get("/runs/{run_id}/diagnostics")
    def diagnostics(run_id: str):
        def read():
            folder = service.store.folder(run_id)
            path = folder / "stderr.log"
            # UI receives only the tail; complete logs remain on disk.
            with path.open("rb") as file:
                file.seek(max(0, path.stat().st_size - 65536))
                text = file.read().decode("utf-8", errors="replace")
            return {"path": str(folder), "stderr": text}
        return service_call(read)

    @router.get("/runs/{run_id}/lrc")
    def export(run_id: str):
        def read():
            run = service.store.get(run_id)
            if run["status"] != "completed":
                raise ValueError("No complete engine result")
            return FileResponse(service.store.folder(run_id) / "output" / "result.lrc", filename="result.lrc")
        return service_call(read)

    @router.post("/batches")
    def batch(request: BatchRequest):
        return service_call(lambda: service.batch(request))

    @router.get("/batches/{batch_id}")
    def get_batch(batch_id: str):
        def read():
            parent = service.store.get(batch_id)
            return {**parent, "runs": [{k: v for k, v in service.store.get(r).items() if k not in {"snapshot", "command"}}
                                      for r in parent["children"]]}
        return service_call(read)

    @router.post("/batches/{batch_id}/cancel")
    def cancel_batch(batch_id: str):
        return service_call(lambda: service.cancel(batch_id))

    @router.post("/batches/{batch_id}/retry")
    def retry(batch_id: str):
        def retry_failed():
            parent = service.store.get(batch_id)
            if parent["status"] in ACTIVE:
                raise ValueError("Queue is still active")
            ids = [r["project_id"] for rid in parent["children"]
                   if (r := service.store.get(rid))["status"] == "failed"]
            return service.batch(BatchRequest(project_ids=ids, options=parent["options"]),
                                 languages={r["project_id"]: r["language"] for rid in parent["children"]
                                            if (r := service.store.get(rid))["project_id"] in ids})
        return service_call(retry_failed)

    @router.post("/batches/{batch_id}/resume")
    def resume(batch_id: str):
        def resume_pending():
            parent = service.store.get(batch_id)
            if parent["status"] in ACTIVE:
                raise ValueError("Queue is still active")
            ids = [r["project_id"] for rid in parent["children"]
                   if (r := service.store.get(rid))["status"] in {"interrupted", "cancelled"}]
            return service.batch(BatchRequest(project_ids=ids, options=parent["options"]),
                                 languages={r["project_id"]: r["language"] for rid in parent["children"]
                                            if (r := service.store.get(rid))["project_id"] in ids})
        return service_call(resume_pending)

    @router.get("/models")
    def models():
        return service_call(services.runtime.models.snapshot)

    @router.post("/models")
    def manage_models(request: ModelAction):
        return service_call(lambda: services.runtime.models.start(request))


    @router.delete("/runs/{run_id}")
    def delete_result(run_id: str):
        def delete():
            if not services.jobs.resource_lock.acquire(blocking=False):
                raise ValueError("Auto Timing resources are busy")
            try:
                record = service.store.get(run_id)
                if record["kind"] != "run":
                    raise ValueError("Delete individual results")
                if record["status"] in ACTIVE:
                    raise ValueError("Run is still active")
                if record.get("batch_id"):
                    parent = service.store.get(record["batch_id"])
                    remaining = [r for r in parent["children"] if r != run_id]
                    if remaining:
                        service.store.update(parent["id"], children=remaining)
                    else:
                        shutil.rmtree(service.store.folder(parent["id"]))
                shutil.rmtree(service.store.folder(run_id))
                return {"deleted": True}
            finally:
                services.jobs.resource_lock.release()
        return service_call(delete)

    return router
