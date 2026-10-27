"""Native component smoke check with relocated long paths; no models or inference."""
from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path
import shutil
import subprocess
import tempfile


def validate(python: Path, components: Path):
    with tempfile.TemporaryDirectory(prefix="rollingpebble-pronunciation-") as temporary:
        label = "relocated components"
        moved = Path(temporary) / label / "发音组件"
        while len(str(moved)) <= 175:
            label += " relocated components"
            moved = Path(temporary) / label / "发音组件"
        shutil.copytree(components, moved)
        assert len(str(moved)) > 160
        env = {k: v for k, v in os.environ.items() if k.upper() in {"HOME", "TMPDIR", "LANG", "SYSTEMROOT", "WINDIR", "TEMP", "TMP", "USERPROFILE"}}
        system_path = str(Path(os.environ.get("SystemRoot", "C:/Windows")) / "System32") if sys.platform == "win32" else "/usr/bin:/bin"
        library = "libespeak-ng.dll" if sys.platform == "win32" else "libespeak-ng.1.dylib" if sys.platform == "darwin" else "libespeak-ng.so.1"
        env.update(PATH=system_path, PHONEMIZER_ESPEAK_LIBRARY=str(moved / library),
                   ESPEAK_DATA_PATH=str(moved), HF_HUB_OFFLINE="1", TRANSFORMERS_OFFLINE="1")
        script = """
import os
import sys
from pathlib import Path
from phonemizer.backend import EspeakBackend
from phonemizer.backend.espeak.wrapper import EspeakWrapper
wrapper = EspeakWrapper()
assert wrapper.data_path.resolve() == (Path(os.environ['ESPEAK_DATA_PATH']) / 'espeak-ng-data').resolve()
assert EspeakBackend.version() == (1, 52, 0)
for language, text in [('en-us', 'Hello world'), ('cmn', '你好世界'), ('ru', 'Привет мир')]:
    assert EspeakBackend(language).phonemize([text], strip=True)[0]
from pyroller.language import resolve_language
for text, expected in [('Hello', 'en'), ('繁體歌詞', 'zh'), ('你好 Hello', 'zh-en'), ('Привет', 'mul'), ('こんにちは', 'mul')]:
    assert resolve_language(text, 'auto') == expected
print('Long-path relocated eSpeak 1.52.0, en/zh/ru pronunciation and Auto language contracts passed.')
"""
        subprocess.run([str(python.absolute()), "-c", script], env=env, check=True, timeout=60)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--python", type=Path, required=True)
    parser.add_argument("--components", type=Path, required=True)
    args = parser.parse_args()
    validate(args.python, args.components)
