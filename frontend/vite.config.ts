import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { readdirSync, readFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath, URL } from "node:url";

const jsonSuffix = ".json";
const langDir = fileURLToPath(new URL("./src/languages", import.meta.url));
const langFiles = readdirSync(langDir).filter((filename) => filename.endsWith(jsonSuffix)).sort();
const langCodeList = langFiles.map((filename) => basename(filename, jsonSuffix));
const langMap = langFiles.map((filename) => {
    const langCode = basename(filename, jsonSuffix);
    const content = JSON.parse(readFileSync(join(langDir, filename), "utf-8")) as { languageName?: string };
    return [langCode, content.languageName || langCode] as const;
});

const rootDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = dirname(rootDir);

const projectVersion = (() => {
    let inProjectSection = false;
    for (const line of readFileSync(join(repoRoot, "pyproject.toml"), "utf-8").split(/\r?\n/)) {
        const trimmed = line.trim();
        if (trimmed === "[project]") {
            inProjectSection = true;
            continue;
        }
        if (inProjectSection && trimmed.startsWith("[")) break;
        if (!inProjectSection || !trimmed.startsWith("version")) continue;
        return trimmed.split("=", 2)[1]?.trim().replace(/^"|"$/g, "") || "dev";
    }
    return "dev";
})();

export default defineConfig({
    plugins: [react()],
    define: {
        "import.meta.env.app": JSON.stringify({
            hash: "dev",
            updateTime: new Date().toISOString(),
            version: projectVersion,
        }),
        "i18n.langCodeList": JSON.stringify(langCodeList),
        "i18n.langMap": JSON.stringify(langMap),
    },
    resolve: {
        alias: {
            "#const": fileURLToPath(new URL("./src/const", import.meta.url)),
        },
    },
    server: {
        host: "127.0.0.1",
        port: 5173,
        proxy: {
            "/api": "http://127.0.0.1:6789",
        },
    },
    build: {
        outDir: "dist",
        sourcemap: true,
    },
});
