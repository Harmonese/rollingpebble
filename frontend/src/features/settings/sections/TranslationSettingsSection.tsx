import { useContext, useEffect, useRef, useState } from "react";
import { backendMessageText } from "../../../shared/api/request.js";
import {
    cancelTranslation,
    getTranslation,
    saveTranslationConnection,
    startTranslation,
    type TranslationConnection,
    translationConnection,
} from "../../../shared/api/translation.js";
import { appContext } from "../../../shared/appContext.js";
import { ActionRow, Button, FormGrid, MessageText, TaskStatus } from "../../../ui/index.js";

export function TranslationSettingsSection() {
    const { lang } = useContext(appContext);
    const t = lang.translation;
    const [config, setConfig] = useState<TranslationConnection | null>(null);
    const [key, setKey] = useState("");
    const [keyEdited, setKeyEdited] = useState(false);
    const [busy, setBusy] = useState(false);
    const [operation, setOperation] = useState<"save" | "test">("save");
    const [testActive, setTestActive] = useState(false);
    const [cancelling, setCancelling] = useState(false);
    const [message, setMessage] = useState("");
    const [error, setError] = useState("");
    const lock = useRef(false);
    const mounted = useRef(true);
    const task = useRef<string | null>(null);
    useEffect(() => {
        mounted.current = true;
        void translationConnection().then(value => {
            if (mounted.current) setConfig(value);
        })
            .catch(e => {
                if (mounted.current) setError(backendMessageText(e, lang.backendMessages));
            });
        return () => {
            mounted.current = false;
            if (task.current) void cancelTranslation(task.current).catch(() => {});
        };
    }, []);
    const save = async (test = false) => {
        if (!config || lock.current) return;
        lock.current = true;
        setBusy(true);
        setOperation(test ? "test" : "save");
        setCancelling(false);
        setMessage("");
        setError("");
        try {
            const next = await saveTranslationConnection({ ...config, ...(keyEdited ? { api_key: key } : {}) });
            if (!mounted.current) return;
            setConfig(next);
            setKey("");
            setKeyEdited(false);
            if (test) {
                const id = crypto.randomUUID();
                task.current = id;
                setTestActive(true);
                let job = await startTranslation({
                    request_id: id,
                    workspace_id: "connection-test",
                    revision: id,
                    source_language: "auto",
                    target_language: "en",
                    lines: [{ id: "test", text: "OK" }],
                    title: "",
                    artist: "",
                    album: "",
                }, true);
                while (mounted.current && ["running", "cancelling"].includes(job.status)) {
                    await new Promise(resolve => setTimeout(resolve, 500));
                    if (mounted.current) job = await getTranslation(id);
                }
                if (job.status === "failed") throw { code: job.error || "translation.network" };
                if (mounted.current && job.status === "succeeded") setMessage(t.connected);
                if (mounted.current && job.status === "canceled") setMessage(lang.timingV2.cancelled);
            } else setMessage(t.saved);
        } catch (e) {
            if (task.current) await cancelTranslation(task.current).catch(() => {});
            if (mounted.current) setError(backendMessageText(e, lang.backendMessages));
        } finally {
            task.current = null;
            lock.current = false;
            if (mounted.current) {
                setBusy(false);
                setTestActive(false);
                setCancelling(false);
            }
        }
    };
    return (
        <section className="settings-section">
            <h3>{t.title}</h3>
            {config && (
                <>
                    <FormGrid>
                        <label>
                            {t.baseUrl}
                            <input
                                type="url"
                                value={config.base_url}
                                disabled={busy}
                                onChange={e => {
                                    setConfig({ ...config, base_url: e.target.value, has_key: false });
                                    setKey("");
                                    setKeyEdited(false);
                                }}
                            />
                        </label>
                        <label>
                            {t.model}
                            <input
                                value={config.model}
                                disabled={busy}
                                onChange={e => setConfig({ ...config, model: e.target.value })}
                            />
                        </label>
                        <label>
                            {t.apiKey}
                            <input
                                type="password"
                                autoComplete="off"
                                value={key}
                                disabled={busy}
                                placeholder={config.has_key ? t.keyStored : ""}
                                onChange={e => {
                                    setKey(e.target.value);
                                    setKeyEdited(true);
                                }}
                            />
                        </label>
                        <label>
                            {t.proxy}
                            <input
                                type="url"
                                value={config.proxy}
                                disabled={busy}
                                onChange={e => setConfig({ ...config, proxy: e.target.value })}
                            />
                        </label>
                    </FormGrid>
                    <ActionRow title={t.prompt}>
                        <Button
                            disabled={busy || config.prompt === config.default_prompt}
                            onClick={() => setConfig({ ...config, prompt: config.default_prompt })}
                        >
                            {t.resetPrompt}
                        </Button>
                    </ActionRow>
                    <textarea
                        aria-label={t.prompt}
                        className="translation-prompt"
                        rows={7}
                        value={config.prompt}
                        disabled={busy}
                        onChange={e => setConfig({ ...config, prompt: e.target.value })}
                    />
                    {!config.key_persistent && <MessageText>{t.sessionKey}</MessageText>}
                    <ActionRow title={t.connection}>
                        <Button disabled={busy} onClick={() => void save()}>{t.save}</Button>
                        <Button
                            disabled={busy || !config.base_url || !config.model}
                            title={t.testHint}
                            onClick={() => void save(true)}
                        >
                            {t.test}
                        </Button>
                        <Button
                            disabled={busy || !config.has_key}
                            onClick={() => {
                                setKey("");
                                setKeyEdited(true);
                                setConfig({ ...config, has_key: false });
                            }}
                        >
                            {t.clearKey}
                        </Button>
                    </ActionRow>
                </>
            )}
            {(busy || message || error) && (
                <TaskStatus
                    title={busy
                        ? cancelling
                            ? t.cancelling
                            : operation === "test"
                            ? t.connecting
                            : lang.settings.messages.saving
                        : message || t.connection}
                    active={busy}
                    error={error}
                >
                    {busy && operation === "test" && (
                        <Button
                            disabled={!testActive || cancelling}
                            onClick={() => {
                                if (task.current) {
                                    setCancelling(true);
                                    void cancelTranslation(task.current).catch(e => {
                                        if (mounted.current) {
                                            setError(backendMessageText(e, lang.backendMessages));
                                            setCancelling(false);
                                        }
                                    });
                                }
                            }}
                        >
                            {lang.ui.cancel}
                        </Button>
                    )}
                </TaskStatus>
            )}
        </section>
    );
}
