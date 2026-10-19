from __future__ import annotations

import os
import platform
from pathlib import Path

from rollingpebble.paths import StorageLayout

_BASE_ENV_KEYS = {
    "HOME",
    "PATH",
    "LANG",
    "LC_ALL",
    "LC_CTYPE",
    "SSL_CERT_FILE",
    "REQUESTS_CA_BUNDLE",
    "CURL_CA_BUNDLE",
    "SYSTEMROOT",
    "WINDIR",
    "COMSPEC",
    "PATHEXT",
    "TMP",
    "TEMP",
    "TMPDIR",
    "ROLLINGPEBBLE_APP_RESOURCES",
}

_DEV_ENV_KEYS = {"LRC_ROLLER_PYROLLER_SOURCE"}


def build_base_subprocess_env(source: dict[str, str] | None = None, *, include_dev: bool = False) -> dict[str, str]:
    source = source if source is not None else os.environ
    allowed = set(_BASE_ENV_KEYS)
    if include_dev:
        allowed.update(_DEV_ENV_KEYS)
    return {key: value for key, value in source.items() if key in allowed and value}


def runtime_bin_dir(venv: Path) -> Path:
    return venv / ("Scripts" if platform.system().lower() == "windows" else "bin")


def runtime_python_path(venv: Path) -> Path:
    if platform.system().lower() == "windows":
        return venv / "Scripts" / "python.exe"
    return venv / "bin" / "python"


def build_runtime_env(venv: Path, data_dir: Path | StorageLayout, *, include_dev: bool = False) -> dict[str, str]:
    layout = data_dir if isinstance(data_dir, StorageLayout) else StorageLayout.from_data_dir(data_dir)
    env = build_base_subprocess_env(include_dev=include_dev)
    bin_dir = runtime_bin_dir(venv)
    from rollingpebble.runtime.installer import engine_resources
    resources = engine_resources()
    ffmpeg = str(resources / "bin") + os.pathsep if resources else ""
    env.update(
        {
            "PYTHONUNBUFFERED": "1",
            "PYTHONNOUSERSITE": "1",
            "PIP_DISABLE_PIP_VERSION_CHECK": "1",
            "PIP_PROGRESS_BAR": "off",
            "PIP_NO_CACHE_DIR": "1",
            "PIP_CACHE_DIR": str(layout.cache_root / "pip"),
            "XDG_CACHE_HOME": str(layout.cache_root / "xdg"),
            "TORCH_HOME": str(layout.cache_root / "torch"),
            "HF_HOME": str(layout.cache_root / "huggingface"),
            "HUGGINGFACE_HUB_CACHE": str(layout.cache_root / "huggingface" / "hub"),
            "VIRTUAL_ENV": str(venv),
            "PATH": f"{bin_dir}{os.pathsep}{ffmpeg}{env.get('PATH', '')}",
        }
    )
    from rollingpebble.storage.app_settings import SettingsStore
    settings = SettingsStore(layout.app_root).read()
    proxy = settings.auto_timing_hf_proxy
    if proxy and settings.model_proxy_enabled:
        env.update(HTTP_PROXY=proxy, HTTPS_PROXY=proxy)
    for name, value in (("HF_HUB_ETAG_TIMEOUT", settings.auto_timing_hf_etag_timeout),
                        ("HF_HUB_DOWNLOAD_TIMEOUT", settings.auto_timing_hf_download_timeout)):
        if value:
            env[name] = str(int(value))
    return env
