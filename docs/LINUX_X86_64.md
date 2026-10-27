# Linux x86_64 构建与测试

所有命令从仓库根目录运行。Linux 构建和验收基线为 Ubuntu 24.04 x86_64；当前源码版本为 0.9.1。
## 本机环境

需要 Python 3.12、Node.js 22、pnpm 10.11.0 和 Rust 工具链。可选的 `.tools` 本机工具目录不会提交到 Git；检测到其中的 Rust 工具链时，编译缓存使用 `.tools/cargo-target`，否则沿用系统工具链和 Cargo 目标目录。

```bash
source scripts/linux-env.sh
rollingpebble dev
```

前端为 http://127.0.0.1:5173，后端为 http://127.0.0.1:6789。开发数据隔离到 `.lrc-roller-data/linux-x86_64`。
需要在源码开发模式启用已准备的自动打轴资源时，额外设置 `ROLLINGPEBBLE_APP_RESOURCES="$PWD/desktop"`。

## 从干净源码准备构建

系统构建依赖（Ubuntu 24.04）：

```bash
sudo apt-get update
sudo apt-get install -y python3.12-venv build-essential cmake curl wget file libssl-dev pkg-config libgtk-3-dev libwebkit2gtk-4.1-dev libayatana-appindicator3-dev librsvg2-dev patchelf desktop-file-utils gstreamer1.0-plugins-base gstreamer1.0-plugins-good gstreamer1.0-libav
```

另外安装 Rust、Node.js 22 和仓库固定的 pnpm 10.11.0，然后在代码根目录：

```bash
python3.12 -m venv .venv
. .venv/bin/activate
python -m pip install -e '.[dev]'
pnpm install --frozen-lockfile
pnpm desktop:build
```

初次构建会联网下载有校验和的独立 Python、固定源码及构建依赖。用户安装应用后的运行时准备使用包内 wheelhouse 离线安装，不需要编译器或系统 Python。
Linux 默认包含 CPU 版 Torch/Torchaudio，不包含 CUDA。模型由用户在应用中明确下载。

共享平台配置位于 `desktop/platforms.json`，Linux 引擎依赖锁为 `desktop/engine-linux-x86_64.lock`。
同一代码入口也支持 macOS arm64 和 Windows x86_64；其他架构尚未配置。
资源定位使用 Tauri 平台 API，发行程序要求包内后端与资源完整，不依赖开发目录。
本机脚本中的旧开发用 `TAURI_CONFIG` 资源覆盖会被打包入口识别并移除。

## 安装包与检查

安装包统一导出到 `dist/desktop/linux-x86_64/`：

- `Rolling Pebble_0.9.1_amd64.deb`
- `Rolling Pebble_0.9.1_amd64.AppImage`
- `SHA256SUMS`、`README.txt`

`.deb` 可用 `sudo apt install ./<文件名>.deb` 安装。AppImage 赋予执行权限后运行；缺少 FUSE 时可使用 `--appimage-extract-and-run`。
该目录中的校验和用于文件完整性校验，不是发行签名。当前仅验收 Ubuntu 24.04 x86_64；其他发行版与较旧 glibc 需另行测试。

```bash
bash scripts/linux-check.sh --native
.venv/bin/python desktop/validate_runtime_distribution.py
.venv/bin/python desktop/validate_linux_bundle.py --deb "dist/desktop/linux-x86_64/Rolling Pebble_0.9.1_amd64.deb" --log-dir output/linux-x86_64/deb-smoke
.venv/bin/python desktop/validate_linux_bundle.py --appimage "dist/desktop/linux-x86_64/Rolling Pebble_0.9.1_amd64.AppImage" --log-dir output/linux-x86_64/appimage-smoke
```

桌面验证需要 Xvfb（可通过 `--xvfb` 指定路径）、xwininfo、dbus-run-session，使用独立显示会话、临时 HOME、空应用数据和系统 PATH，不修改现有用户项目。
验证覆盖真实原生窗口、前端静态资源、首次自动离线准备、关闭窗口后的正常退出和后端进程清理。
全部构建与验收日志位于 `output/linux-x86_64/`。

手工编辑、音频播放、文件选择、项目恢复和真实歌曲打轴仍需交互验收；离线组件检查不代表模型推理质量验收。

Python wheel/sdist 的独立构建入口仍为 `bash scripts/linux-build-python.sh`。
