from __future__ import annotations

import platform
import subprocess
from pathlib import Path


def _osascript_quote(value: str) -> str:
    return value.replace('\\', '\\\\').replace('"', '\\"')


def _select_path_macos(*, mode: str, title: str, initial_path: str | None) -> str:
    prompt = _osascript_quote(title or "Select path")
    if mode == "directory":
        script = f'POSIX path of (choose folder with prompt "{prompt}")'
    else:
        script = f'POSIX path of (choose file with prompt "{prompt}")'
    if initial_path:
        path = Path(initial_path).expanduser()
        if path.exists():
            script = script[:-1] + f' default location POSIX file "{_osascript_quote(str(path))}")'
    result = subprocess.run(["osascript", "-e", script], capture_output=True, text=True)
    if result.returncode != 0:
        if "User canceled" in result.stderr:
            return ""
        raise RuntimeError(result.stderr.strip() or "Path selection failed")
    return result.stdout.strip()


def _select_path_tk(*, mode: str, title: str, initial_path: str | None) -> str:
    import tkinter as tk
    from tkinter import filedialog

    root = tk.Tk()
    root.withdraw()
    root.attributes("-topmost", True)
    kwargs = {"title": title or "Select path"}
    if initial_path:
        expanded = Path(initial_path).expanduser()
        if expanded.exists():
            kwargs["initialdir"] = str(expanded if expanded.is_dir() else expanded.parent)
    try:
        if mode == "directory":
            selected = filedialog.askdirectory(**kwargs)
        else:
            selected = filedialog.askopenfilename(**kwargs)
    finally:
        root.destroy()
    return str(selected or "")


def _select_path_windows(*, mode: str, title: str, initial_path: str | None) -> str:
    if mode != "directory":
        return _select_path_tk(mode=mode, title=title, initial_path=initial_path)
    ps = r'''
Add-Type -AssemblyName System.Windows.Forms | Out-Null
$dialog = New-Object System.Windows.Forms.FolderBrowserDialog
$dialog.Description = $env:LRC_ROLLER_DIALOG_TITLE
if ($env:LRC_ROLLER_DIALOG_INITIAL -and (Test-Path $env:LRC_ROLLER_DIALOG_INITIAL)) { $dialog.SelectedPath = $env:LRC_ROLLER_DIALOG_INITIAL }
if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { Write-Output $dialog.SelectedPath }
'''
    env_title = title or "Select folder"
    import os
    env = os.environ.copy()
    env["LRC_ROLLER_DIALOG_TITLE"] = env_title
    env["LRC_ROLLER_DIALOG_INITIAL"] = str(Path(initial_path).expanduser()) if initial_path else ""
    result = subprocess.run(["powershell", "-NoProfile", "-Command", ps], capture_output=True, text=True, env=env)
    if result.returncode != 0:
        raise RuntimeError(result.stderr.strip() or "Path selection failed")
    return result.stdout.strip()


def select_local_path(*, mode: str = "directory", title: str = "Select path", initial_path: str | None = None) -> str:
    system = platform.system().lower()
    if system == "darwin":
        try:
            return _select_path_macos(mode=mode, title=title, initial_path=initial_path)
        except Exception:
            return _select_path_tk(mode=mode, title=title, initial_path=initial_path)
    if system == "windows":
        try:
            return _select_path_windows(mode=mode, title=title, initial_path=initial_path)
        except Exception:
            return _select_path_tk(mode=mode, title=title, initial_path=initial_path)
    return _select_path_tk(mode=mode, title=title, initial_path=initial_path)
