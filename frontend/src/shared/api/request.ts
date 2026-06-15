import type { BackendMessage } from "./types.js";

function parseResponseText(text: string): unknown {
    if (!text) {
        return null;
    }
    try {
        return JSON.parse(text);
    } catch {
        return text;
    }
}

function extractErrorDetail(payload: unknown, fallback: string): string {
    if (!payload) {
        return fallback;
    }
    if (typeof payload === "string") {
        return payload || fallback;
    }
    if (typeof payload === "object" && "detail" in payload) {
        const detail = (payload as { detail?: unknown }).detail;
        if (typeof detail === "string") {
            return detail;
        }
        return JSON.stringify(detail);
    }
    return JSON.stringify(payload);
}

function isBackendMessage(value: unknown): value is BackendMessage {
    return Boolean(
        value
            && typeof value === "object"
            && "code" in value
            && typeof (value as { code?: unknown }).code === "string",
    );
}

function extractBackendMessage(payload: unknown): BackendMessage | null {
    if (isBackendMessage(payload)) return payload;
    if (payload && typeof payload === "object" && "detail" in payload) {
        const detail = (payload as { detail?: unknown }).detail;
        return isBackendMessage(detail) ? detail : null;
    }
    return null;
}

function renderMessageTemplate(template: string, params?: BackendMessage["params"]): string {
    return template.replace(/\{([a-zA-Z0-9_]+)\}/g, (match, key) => {
        const value = params?.[key];
        return value === undefined || value === null ? match : String(value);
    });
}

export class BackendApiError extends Error {
    backendMessage: BackendMessage | null;
    status: number;

    constructor(message: string, options: { backendMessage?: BackendMessage | null; status: number }) {
        super(message);
        this.name = "BackendApiError";
        this.backendMessage = options.backendMessage || null;
        this.status = options.status;
    }
}

export function backendMessageText(value: unknown, messages: Record<string, string | undefined>): string {
    const backendMessage = value instanceof BackendApiError
        ? value.backendMessage
        : isBackendMessage(value)
            ? value
            : null;
    if (backendMessage) {
        const template = messages[backendMessage.code];
        if (template) return renderMessageTemplate(template, backendMessage.params);
        if (backendMessage.fallback) return renderMessageTemplate(backendMessage.fallback, backendMessage.params);
        return backendMessage.code;
    }
    if (value instanceof Error) return value.message;
    if (typeof value === "string") return value;
    return String(value);
}

export async function request<T>(url: string, init?: RequestInit): Promise<T> {
    const response = await fetch(url, {
        ...init,
        headers: init?.body instanceof FormData
            ? init.headers
            : { "Content-Type": "application/json", ...init?.headers },
    });

    // A fetch response body can only be consumed once. Read it as text once,
    // then parse JSON from that string when possible.
    const text = await response.text();
    const payload = parseResponseText(text);

    if (!response.ok) {
        const backendMessage = extractBackendMessage(payload);
        const message = backendMessage?.fallback || extractErrorDetail(payload, response.statusText);
        throw new BackendApiError(message, { backendMessage, status: response.status });
    }

    return payload as T;
}
