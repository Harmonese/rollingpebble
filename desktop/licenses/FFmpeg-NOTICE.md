# FFmpeg

The bundled standalone FFmpeg 7.1 executable is built from unmodified source by
desktop/prepare_ffmpeg.py and invoked as a separate subprocess.
Copyright (c) 2000-2024 the FFmpeg developers.

This build disables GPL and nonfree components and external optional libraries.
It uses the GNU Lesser General Public License version 2.1 or later.
See FFmpeg-LGPL-2.1.txt and FFmpeg-BUILD.txt beside this notice. The complete
unmodified corresponding source is included as ffmpeg-7.1.tar.xz. Build using
the configure flags in FFmpeg-BUILD.txt followed by make ffmpeg on macOS arm64.

- FFmpeg source: https://github.com/FFmpeg/FFmpeg/tree/n7.1
- FFmpeg source archive: https://ffmpeg.org/releases/ffmpeg-7.1.tar.xz
- FFmpeg licensing: https://ffmpeg.org/legal.html

The executable and source hashes are recorded in engine/manifest.json. The app
does not link to FFmpeg; replacing the standalone executable does not require
rebuilding the host. Preserve this notice, license, source archive and build
parameters in distributions.
