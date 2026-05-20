from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path
from typing import Mapping


@dataclass(frozen=True, slots=True)
class RuntimeDependencyRecipe:
    pyroller_spec: str
    support_specs: tuple[str, ...]
    bootstrap_specs: tuple[str, ...]
    event_prefix: str

    def source_from_env(self, env: Mapping[str, str] | None = None) -> str | None:
        source = (env or os.environ).get("LRC_ROLLER_PYROLLER_SOURCE", "").strip()
        return source or None

    def source_label(self, source: str | None = None) -> str:
        if source:
            return f"editable:{Path(source).expanduser().resolve()}"
        return self.pyroller_spec

    def bootstrap_command(self, python: Path) -> list[str]:
        return [str(python), "-m", "pip", "install", "-U", *self.bootstrap_specs]

    def pyroller_install_command(self, python: Path, source: str | None = None) -> list[str]:
        if source:
            source_path = Path(source).expanduser().resolve()
            return [str(python), "-m", "pip", "install", "-e", str(source_path)]
        return [str(python), "-m", "pip", "install", "--upgrade", self.pyroller_spec]

    def support_install_command(self, python: Path) -> list[str] | None:
        if not self.support_specs:
            return None
        return [str(python), "-m", "pip", "install", "--upgrade", *self.support_specs]

    def dependency_install_commands(
        self,
        python: Path,
        *,
        source: str | None = None,
        include_bootstrap: bool = False,
    ) -> list[list[str]]:
        commands: list[list[str]] = []
        if include_bootstrap:
            commands.append(self.bootstrap_command(python))
        commands.append(self.pyroller_install_command(python, source))
        support_command = self.support_install_command(python)
        if support_command is not None:
            commands.append(support_command)
        return commands


DEFAULT_RUNTIME_RECIPE = RuntimeDependencyRecipe(
    pyroller_spec="py-roller>=0.6.2,<0.8",
    support_specs=("PySocks>=1.7.1",),
    bootstrap_specs=("pip", "setuptools", "wheel"),
    event_prefix="PYROLLER_EVENT ",
)
