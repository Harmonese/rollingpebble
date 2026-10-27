import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readdir, readFile, mkdir, copyFile, writeFile } from "node:fs/promises";
import { join, basename, resolve } from "node:path";
import { pathToFileURL } from "node:url";

export async function exportArtifacts(args = []) {
    const metadata = spawnSync("cargo", ["metadata", "--no-deps", "--format-version", "1", "--manifest-path", "src-tauri/Cargo.toml"], { encoding: "utf8" });
    if (metadata.status !== 0) throw new Error(metadata.stderr);
    const targetDir = JSON.parse(metadata.stdout).target_directory;
    const targetArg = args.findIndex(arg => arg === "--target");
    const target = (targetArg >= 0 ? args[targetArg + 1] : args.find(arg => arg.startsWith("--target="))?.split("=")[1]) || process.env.CARGO_BUILD_TARGET;
    const source = join(targetDir, ...(target ? [target] : []), args.includes("--debug") ? "debug" : "release", "bundle");
    const config = JSON.parse(await readFile("src-tauri/tauri.conf.json", "utf8"));
    const machine = process.arch === "x64" ? "x86_64" : process.arch;
    const platforms = JSON.parse(await readFile("desktop/platforms.json", "utf8"));
    const platform = Object.keys(platforms).find(key => platforms[key].system === process.platform && platforms[key].machine === machine);
    if (!platform) throw new Error(`No artifact destination for ${process.platform}/${process.arch}`);
    const destination = join("dist", "desktop", platform);
    await mkdir(destination, { recursive: true });
    const artifacts = [];
    async function collect(directory) {
        for (const item of await readdir(directory, { withFileTypes: true })) {
            const path = join(directory, item.name);
            if (item.isDirectory() && !item.name.endsWith(".app") && !item.name.endsWith(".AppDir")) await collect(path);
            else if (item.isFile() && /\.(deb|AppImage|dmg|msi|exe)$/.test(item.name) && item.name.includes(config.version)) artifacts.push(path);
        }
    }
    await collect(source);
    if (!artifacts.length) throw new Error(`No installers found in ${source}`);
    const sums = [];
    for (const artifact of artifacts.sort()) {
        const output = join(destination, basename(artifact));
        await copyFile(artifact, output);
        const hash = createHash("sha256");
        for await (const chunk of createReadStream(output)) hash.update(chunk);
        sums.push(`${hash.digest("hex")}  ${basename(output)}`);
    }
    await writeFile(join(destination, "SHA256SUMS"), sums.join("\n") + "\n");
    const instructions = platform.startsWith("linux")
        ? "Ubuntu 24.04 x86_64 is the validated Linux baseline.\nInstall the .deb with: sudo apt install ./<package>.deb\nOr chmod +x the AppImage and run it. If FUSE is unavailable, use --appimage-extract-and-run."
        : platform.startsWith("windows")
        ? "Run the x64 setup.exe to install for the current user. Windows 10 version 1903 or newer / Windows 11 x64 and Microsoft Edge WebView2 are required. The installer can download WebView2 when missing. This local build is unsigned.\nVerify hashes with PowerShell: Get-FileHash *.exe -Algorithm SHA256"
        : "Open the DMG and copy Rolling Pebble.app into Applications. See docs/DESKTOP.md for supported macOS versions.";
    await writeFile(join(destination, "README.txt"), `Rolling Pebble ${config.version} — ${platform}\n\n${instructions}\nPython 3.12, platform engine wheels, FFmpeg and eSpeak are bundled.\nModel weights are downloaded separately through the app.\nVerify integrity with: sha256sum -c SHA256SUMS\n`);
    console.log(`Installers and SHA256SUMS: ${resolve(destination)}`);
    return destination;
}

if (import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await exportArtifacts(process.argv.slice(2));
