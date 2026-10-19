from __future__ import annotations

import hashlib
import http.client
import re
import urllib.error
import urllib.request
from urllib.parse import urlsplit

from rollingpebble.messages import AppError


class ModelCancelled(Exception):
    pass


def check_cancel(cancel):
    if cancel.is_set():
        raise ModelCancelled()


def validate_proxy(value):
    try:
        parsed = urlsplit(value)
        valid = parsed.scheme in {"http", "https"} and parsed.hostname and parsed.port != 0
    except ValueError:
        valid = False
    if not valid:
        raise AppError("models.proxy", "Use an HTTP or HTTPS proxy address.")


def download_opener(proxy):
    if proxy:
        validate_proxy(proxy)
    # An empty mapping explicitly disables environment and macOS system proxies.
    return urllib.request.build_opener(urllib.request.ProxyHandler(
        {"http": proxy, "https": proxy} if proxy else {}))


def file_digest(path, cancel, advance=lambda count: None):
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        while block := stream.read(4 * 1024 * 1024):
            check_cancel(cancel)
            digest.update(block)
            advance(len(block))
    check_cancel(cancel)
    return digest.hexdigest()


def download_file(file, url, path, *, opener, cancel, progress, timeout, verify=True):
    """Resume only validated ranges; all errors leave bounded, reusable partial files."""
    if path.is_symlink():
        raise AppError("models.path", "Model path is not a managed directory.")
    if path.exists() and path.stat().st_size > file.size:
        path.unlink()
    for attempt in range(3):
        check_cancel(cancel)
        offset = path.stat().st_size if path.exists() else 0
        progress(offset)
        if offset == file.size:
            if not verify or file_digest(path, cancel) == file.sha256:
                return
            path.unlink()
            offset = 0
            progress(0)
        try:
            request = urllib.request.Request(url, headers={"Accept-Encoding": "identity",
                **({"Range": f"bytes={offset}-"} if offset else {})})
            with opener.open(request, timeout=min(timeout, 30)) as response:
                status = response.status
                if status == 206:
                    match = re.fullmatch(r"bytes (\d+)-(\d+)/(\d+)", response.headers.get("Content-Range", ""))
                    if not match or (int(match[1]), int(match[3])) != (offset, file.size) or int(match[2]) != file.size - 1:
                        raise AppError("models.range", "The download server returned an invalid range.")
                elif status == 200:
                    offset = 0
                else:
                    raise AppError("models.download_failed", "Model download failed.")
                length = response.headers.get("Content-Length")
                if length is not None and int(length) != file.size - offset:
                    raise AppError("models.range", "The download server returned an invalid range.")
                with path.open("ab" if offset else "wb") as stream:
                    while block := response.read(256 * 1024):
                        check_cancel(cancel)
                        if offset + len(block) > file.size:
                            raise AppError("models.range", "The download server returned an invalid range.")
                        stream.write(block)
                        offset += len(block)
                        progress(offset)
                if offset != file.size:
                    raise AppError("models.download_failed", "Model download was interrupted.")
            if verify and file_digest(path, cancel) != file.sha256:
                path.unlink()
                raise AppError("models.hash", "Model checksum did not match.")
            return
        except ModelCancelled:
            raise
        except (OSError, http.client.HTTPException) as exc:
            if getattr(exc, "errno", None) == 28:
                raise AppError("models.disk_full", "Not enough disk space.") from None
            if attempt == 2:
                # urllib errors may contain credential-bearing proxy URLs.
                raise AppError("models.download_failed", "Model download failed. Check the source and proxy.") from None
        except AppError:
            if attempt == 2:
                raise
        if cancel.wait(attempt + 1):
            raise ModelCancelled()
