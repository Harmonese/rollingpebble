"""Windows distribution layout must survive copying out of Program Files."""
import sys
from pathlib import PureWindowsPath

import pytest

from rollingpebble.runtime import python as runtime
from rollingpebble.runtime.environment import build_base_subprocess_env
from rollingpebble.runtime import environment


@pytest.mark.parametrize("source,expected", [
    (r"\\?\C:\应用目录\engine\espeak", r"C:\应用目录\engine\espeak"),
    (r"\\?\UNC\server\share\engine\espeak", r"\\server\share\engine\espeak"),
    (r"C:\Apps\Rolling Pebble\engine\espeak", r"C:\Apps\Rolling Pebble\engine\espeak"),
])
def test_native_component_paths_accept_tauri_windows_resources(monkeypatch, source, expected):
    monkeypatch.setattr(environment.platform, "system", lambda: "Windows")
    assert environment._native_component_path(PureWindowsPath(source)) == expected


def test_runtime_env_normalizes_espeak_verbatim_paths(tmp_path, monkeypatch):
    monkeypatch.setattr(environment.platform, "system", lambda: "Windows")
    monkeypatch.setattr("rollingpebble.runtime.installer.engine_resources",
                        lambda: PureWindowsPath(r"\\?\C:\Apps\歌词工具\engine"))
    env = environment.build_runtime_env(tmp_path / "venv", tmp_path)
    assert env["ESPEAK_DATA_PATH"] == r"C:\Apps\歌词工具\engine\espeak"
    assert env["PHONEMIZER_ESPEAK_LIBRARY"] == r"C:\Apps\歌词工具\engine\espeak\libespeak-ng.dll"


def test_runtime_worker_preserves_windows_home_and_appdata():
    source = dict(USERPROFILE="C:/Users/Test", HOMEDRIVE="C:", HOMEPATH="/Users/Test",
                  APPDATA="C:/Users/Test/AppData/Roaming", LOCALAPPDATA="C:/Users/Test/AppData/Local",
                  SYSTEMROOT="C:/Windows", PATH="C:/Windows/System32", PYTHONPATH="developer-only",
                  HTTPS_PROXY="http://user-proxy", API_TOKEN="secret")
    env = build_base_subprocess_env(source)
    assert all(env[key] == source[key] for key in ("USERPROFILE", "HOMEDRIVE", "HOMEPATH", "APPDATA", "LOCALAPPDATA"))
    assert "PYTHONPATH" not in env and "HTTPS_PROXY" not in env and "API_TOKEN" not in env


@pytest.mark.skipif(sys.platform != "win32", reason="Windows runtime layout")
def test_windows_bundled_runtime_relocates_complete_root(tmp_path, monkeypatch):
    resources = tmp_path / "安装包 resources"
    source = resources / "python-runtime"
    source.mkdir(parents=True)
    (source / "python.exe").write_bytes(b"interpreter")
    (source / "python312.dll").write_bytes(b"runtime DLL")
    (source / "Lib").mkdir()
    (source / "Lib" / "ssl.py").write_text("stdlib")
    monkeypatch.setenv("ROLLINGPEBBLE_APP_RESOURCES", str(resources))
    monkeypatch.delenv("ROLLINGPEBBLE_BUNDLED_PYTHON", raising=False)
    monkeypatch.setattr(runtime, "_version_for", lambda path: (3, 12))
    python = runtime.prepare_bundled_runtime(tmp_path / "用户数据")
    assert python.name == "python.exe"
    assert python.parent != source
    assert (python.parent / "python312.dll").read_bytes() == b"runtime DLL"
    assert (python.parent / "Lib" / "ssl.py").read_text() == "stdlib"
    assert runtime.prepare_bundled_runtime(tmp_path / "用户数据") == python
