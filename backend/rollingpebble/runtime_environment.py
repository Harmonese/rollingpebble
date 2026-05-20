from __future__ import annotations

import os
import platform
from pathlib import Path

from rollingpebble.paths import StorageLayout


def runtime_bin_dir(venv: Path) -> Path:
    return venv / ("Scripts" if platform.system().lower() == "windows" else "bin")


def runtime_python_path(venv: Path) -> Path:
    if platform.system().lower() == "windows":
        return venv / "Scripts" / "python.exe"
    return venv / "bin" / "python"


def build_runtime_env(venv: Path, data_dir: Path | StorageLayout) -> dict[str, str]:
    layout = data_dir if isinstance(data_dir, StorageLayout) else StorageLayout.from_data_dir(data_dir)
    env = os.environ.copy()
    bin_dir = runtime_bin_dir(venv)
    env.update(
        {
            "PYTHONUNBUFFERED": "1",
            "PYTHONNOUSERSITE": "1",
            "PIP_DISABLE_PIP_VERSION_CHECK": "1",
            "PIP_PROGRESS_BAR": "off",
            "PIP_CACHE_DIR": str(layout.cache_root / "pip"),
            "XDG_CACHE_HOME": str(layout.cache_root / "xdg"),
            "TORCH_HOME": str(layout.models_root / "torch"),
            "HF_HOME": str(
                layout.models_root / "transcriber" / "providers" / "huggingface"
            ),
            "HUGGINGFACE_HUB_CACHE": str(
                layout.models_root / "transcriber" / "providers" / "huggingface" / "hub"
            ),
            "VIRTUAL_ENV": str(venv),
            "PATH": f"{bin_dir}{os.pathsep}{env.get('PATH', '')}",
        }
    )
    return env
