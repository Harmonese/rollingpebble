from __future__ import annotations

import argparse
import subprocess
from pathlib import Path

from rollingpebble.runtime.environment import build_runtime_env, runtime_python_path
from rollingpebble.runtime.recipe import DEFAULT_RUNTIME_RECIPE


def _run(command: list[str], *, env: dict[str, str]) -> None:
    print(f"$ {' '.join(command)}", flush=True)
    subprocess.run(command, check=True, env=env)


def upgrade_dependencies(data_dir: Path, venv: Path) -> None:
    python = runtime_python_path(venv)
    env = build_runtime_env(venv, data_dir, include_dev=True)
    source = DEFAULT_RUNTIME_RECIPE.source_from_env()
    print(
        f"Installing/upgrading py-roller runtime package: {DEFAULT_RUNTIME_RECIPE.source_label(source)}",
        flush=True,
    )
    commands = DEFAULT_RUNTIME_RECIPE.dependency_install_commands(python, source=source)
    for command in commands:
        _run(command, env=env)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Install or upgrade rollingpebble py-roller runtime dependencies."
    )
    subparsers = parser.add_subparsers(dest="command", required=True)
    upgrade = subparsers.add_parser("upgrade", help="Upgrade py-roller runtime dependencies in an existing venv")
    upgrade.add_argument("--data-dir", required=True)
    upgrade.add_argument("--venv", required=True)
    args = parser.parse_args(argv)

    if args.command == "upgrade":
        upgrade_dependencies(
            Path(args.data_dir).expanduser().resolve(),
            Path(args.venv).expanduser().resolve(),
        )
        return 0
    return 2


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
