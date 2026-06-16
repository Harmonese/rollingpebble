import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const languagesDir = path.resolve(__dirname, "../src/languages");
const baseFile = "en-US.json";

const allowedExactValues = new Set([
    "{message}",
    "Rolling Pebble",
    "Commit hash",
    "py-roller",
    "pylrclib",
    "LRCLIB",
    "LRCLIB ID",
    "NetEase",
    "GitHub",
    "Bandcamp",
    "CUDA",
    "CUDA 12.4",
    "HF XET / CAS",
    "MPS",
    "VAD",
    "LRC",
    "ASS",
    "ASS Karaoke",
    "Apple Silicon / MPS",
    "Apple Silicon / MPS (Torch backends)",
]);

const allowedKeyPatterns = [
    /^app\.(name|fullname)$/,
    /^about\.(title|authorGithub|authorMusic)$/,
    /^backendMessages\.system\.error$/,
    /^backendMessages\.upload\.(plan\.reason|plan\.warning|run\.message)$/,
    /^optionLabels\.(CUDA|Apple Silicon \/ MPS|Apple Silicon \/ MPS \(Torch backends\))$/,
    /^settings\.autoTiming\.hfXet$/,
    /^ui\.(lrclib|lrclibId|sourceLrclib|cuda124)$/,
];

function readJson(file) {
    return JSON.parse(readFileSync(path.join(languagesDir, file), "utf8"));
}

function flatten(value, prefix = "", output = {}) {
    if (value && typeof value === "object" && !Array.isArray(value)) {
        for (const [key, child] of Object.entries(value)) {
            flatten(child, prefix ? `${prefix}.${key}` : key, output);
        }
        return output;
    }
    output[prefix] = value;
    return output;
}

function isVisibleEnglish(value) {
    return typeof value === "string"
        && value.length > 3
        && /[A-Za-z]{3,}/.test(value)
        && /[aeiouAEIOU]/.test(value);
}

function isAllowed(key, value) {
    return allowedExactValues.has(value) || allowedKeyPatterns.some((pattern) => pattern.test(key));
}

function parseLocalesArg() {
    const index = process.argv.indexOf("--locales");
    if (index < 0) return null;
    const value = process.argv[index + 1] || "";
    return new Set(value.split(",").map((item) => item.trim()).filter(Boolean).map((item) => `${item}.json`));
}

const requestedLocales = parseLocalesArg();
const base = flatten(readJson(baseFile));
const files = readdirSync(languagesDir)
    .filter((file) => file.endsWith(".json") && file !== baseFile)
    .filter((file) => !requestedLocales || requestedLocales.has(file))
    .sort();

let totalFindings = 0;
for (const file of files) {
    const translated = flatten(readJson(file));
    const findings = [];
    for (const [key, value] of Object.entries(translated)) {
        if (value === base[key] && isVisibleEnglish(value) && !isAllowed(key, value)) {
            findings.push({ key, value });
        }
    }
    if (findings.length === 0) continue;
    totalFindings += findings.length;
    console.log(`\n${file}: ${findings.length} possible untranslated string(s)`);
    for (const finding of findings) {
        console.log(`  ${finding.key}: ${finding.value}`);
    }
}

if (totalFindings > 0) {
    console.error(`\nFound ${totalFindings} possible untranslated string(s).`);
    process.exit(1);
}

console.log("No obvious untranslated strings found.");
