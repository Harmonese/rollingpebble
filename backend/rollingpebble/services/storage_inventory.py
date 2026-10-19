"""Exclusive disk accounting for the single application data root."""
from pathlib import Path


def inventory(layout, engine: Path | None = None):
    roots = {"projects": layout.projects_root, "models": layout.models_root,
             "results": layout.results_root, "cache": layout.cache_root, "components": layout.runtime_root}
    counts = {key: [0, 0] for key in roots}

    def walk(path):
        if path.name == ".DS_Store" or path.name.startswith("._"):
            return
        if path.is_dir() and not path.is_symlink():
            for child in path.iterdir():
                walk(child)
        elif path.exists() or path.is_symlink():
            category = next((key for key, root in roots.items()
                             if path == root or root in path.parents), "components")
            if layout.app_root / "recovery" in path.parents:
                category = "projects"
            if layout.engine_root in path.parents and layout.models_root not in path.parents:
                category = "cache"
            counts[category][0] += path.lstat().st_size
            counts[category][1] += 1

    if layout.app_root.exists():
        walk(layout.app_root)
    return roots, counts
