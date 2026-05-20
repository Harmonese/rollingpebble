export type PreparedAudioFile = {
    file: File;
    decoded: boolean;
    sourceFormat: "audio" | "ncm" | "qmc";
};

export const AUDIO_UNSUPPORTED_ERROR = "rollingpebble.audio.unsupported";
export const AUDIO_DECODE_WORKER_ERROR = "rollingpebble.audio.decode_worker_failed";

const PLAIN_AUDIO_RE = /\.(?:mp3|flac|wav|m4a|aac|ogg|opus)$/i;
const NCM_RE = /\.ncm$/i;
const QMC_RE = /\.qmc(?:flac|ogg|0|1|2|3)$/i;

type AudioFormat = {
    mime: string;
    extension: string;
};

export const isNeteaseEncryptedAudio = (file: File): boolean => NCM_RE.test(file.name);

export const isQmcEncryptedAudio = (file: File): boolean => QMC_RE.test(file.name);

export const isSupportedAudioFile = (file: File): boolean =>
    file.type.startsWith("audio/") || PLAIN_AUDIO_RE.test(file.name) || isNeteaseEncryptedAudio(file) || isQmcEncryptedAudio(file);

export async function prepareAudioFile(file: File): Promise<PreparedAudioFile> {
    if (file.type.startsWith("audio/") || PLAIN_AUDIO_RE.test(file.name)) {
        return { file, decoded: false, sourceFormat: "audio" };
    }

    if (isNeteaseEncryptedAudio(file)) {
        const data = await decodeWithWorker(file, new URL("../workers/ncmc-worker.ts", import.meta.url));
        return { file: buildDecodedFile(file, data), decoded: true, sourceFormat: "ncm" };
    }

    if (isQmcEncryptedAudio(file)) {
        const data = await decodeWithWorker(file, new URL("../workers/qmc-worker.ts", import.meta.url));
        return { file: buildDecodedFile(file, data), decoded: true, sourceFormat: "qmc" };
    }

    throw new Error(AUDIO_UNSUPPORTED_ERROR);
}

function decodeWithWorker(file: File, workerUrl: URL): Promise<Uint8Array> {
    return new Promise((resolve, reject) => {
        const worker = new Worker(workerUrl, { type: "module" });

        worker.addEventListener(
            "message",
            (ev: MessageEvent<IMessage>) => {
                worker.terminate();
                if (ev.data.type === "success") {
                    resolve(ev.data.payload);
                    return;
                }
                reject(new Error(ev.data.payload));
            },
            { once: true },
        );

        worker.addEventListener(
            "error",
            (ev) => {
                worker.terminate();
                reject(new Error(ev.message || AUDIO_DECODE_WORKER_ERROR));
            },
            { once: true },
        );

        worker.postMessage(file);
    });
}

function buildDecodedFile(source: File, data: Uint8Array): File {
    const format = detectAudioFormat(data);
    const decodedName = replaceEncryptedExtension(source.name, format.extension);
    const bytes = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
    return new File([new Blob([bytes], { type: format.mime })], decodedName, {
        type: format.mime,
        lastModified: source.lastModified,
    });
}

function detectAudioFormat(data: Uint8Array): AudioFormat {
    if (startsWithAscii(data, "fLaC")) {
        return { mime: "audio/flac", extension: ".flac" };
    }
    if (startsWithAscii(data, "OggS")) {
        return { mime: "audio/ogg", extension: ".ogg" };
    }
    if (startsWithAscii(data, "RIFF") && startsWithAscii(data.subarray(8), "WAVE")) {
        return { mime: "audio/wav", extension: ".wav" };
    }
    if (startsWithAscii(data, "ID3") || (data.length >= 2 && data[0] === 0xff && (data[1] & 0xe0) === 0xe0)) {
        return { mime: "audio/mpeg", extension: ".mp3" };
    }
    return { mime: "audio/mpeg", extension: ".mp3" };
}

function startsWithAscii(data: Uint8Array, marker: string): boolean {
    if (data.length < marker.length) {
        return false;
    }
    for (let index = 0; index < marker.length; index += 1) {
        if (data[index] !== marker.charCodeAt(index)) {
            return false;
        }
    }
    return true;
}

function replaceEncryptedExtension(filename: string, extension: string): string {
    return filename.replace(/\.(?:ncm|qmc(?:flac|ogg|0|1|2|3))$/i, extension) || `decoded${extension}`;
}
