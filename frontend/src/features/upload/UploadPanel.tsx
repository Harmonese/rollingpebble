import { useContext, useEffect, useRef, useState } from "react";
import { appContext, AppContextBits } from "../../shared/appContext.js";
import { ButtonGroup, FormGrid, KeyValueList, LogBlock, Message, Panel, Tabs, WarningText } from "../../ui/index.js";

import { useMessage } from "../../hooks/useMessage.js";
import { useSettingsUpdated } from "../../hooks/useSettingsUpdated.js";
import type { Language } from "../../languages/index.js";
import { backendMessageText } from "../../shared/api/request.js";
import { settings } from "../../shared/api/settings.js";
import type { MetaModel, ProjectModel, UploadPlan } from "../../shared/api/types.js";
import { uploadPlan, uploadRun } from "../../shared/api/upload.js";
import { toastPubSub } from "../../ui/Toast.js";
import { NeteaseSearch } from "../shared/NeteaseSearch.js";
import type { NeteaseSearchRenderProps } from "../shared/NeteaseSearch.js";

import { useRequestScope } from "../shared/useRequestScope.js";

type UploadDestination = "lrclib" | "netease";

const uploadModeLabels = (u: Language["ui"]): Record<string, string> => ({
    auto: u.auto,
    mixed: u.mixed,
    synced: u.synced,
    plain: u.plain,
    instrumental: u.instrumental,
});

export const UploadPanel: React.FC<{
    panelSessionId: string;
    workspaceId: string;
    project: ProjectModel | null;
    plainLyrics: string;
    syncedLyrics: string;
    editorMeta: MetaModel;
    onSave: () => Promise<ProjectModel>;
}> = ({ project, plainLyrics, syncedLyrics, editorMeta, onSave, panelSessionId, workspaceId }) => {
    const [destination, setDestination] = useState<UploadDestination>("lrclib");
    const [mode, setMode] = useState("auto");
    const [allowDerivedPlain, setAllowDerivedPlain] = useState(true);
    const [preparedPlan, setPreparedPlan] = useState<{ identity: string; value: UploadPlan } | null>(null);
    const [message, setMessage, , messageFading, messageType, messageKey] = useMessage();
    const { lang } = useContext(appContext, AppContextBits.lang);
    const u = lang.ui;
    const modeLabels = uploadModeLabels(u);
    const [busy, setBusy] = useState(false);

    useSettingsUpdated(async () => {
        try {
            const runtimeSettings = await settings();
            setAllowDerivedPlain(runtimeSettings.upload_derive_plain_from_synced);
        } catch {
            setAllowDerivedPlain(true);
        }
    }, true);

    const identity = JSON.stringify([
        panelSessionId,
        workspaceId,
        project?.project_id,
        mode,
        allowDerivedPlain,
        editorMeta.track,
        editorMeta.artist,
        editorMeta.album,
        editorMeta.duration,
        plainLyrics,
        syncedLyrics,
    ]);
    const scope = useRequestScope(identity);
    const operation = useRef(false);
    const plan = preparedPlan?.identity === identity ? preparedPlan.value : null;
    useEffect(() => {
        setPreparedPlan(null);
        setMessage("");
        setBusy(false);
        operation.current = false;
    }, [identity]);

    const payload = () => ({
        mode,
        allow_derived_plain: allowDerivedPlain,
        metadata: editorMeta,
        plain_lyrics: plainLyrics,
        synced_lyrics: syncedLyrics,
    });

    const makePlan = async () => {
        if (!project) {
            setMessage(u.noProject, "warning");
            return;
        }
        if (!scope.snapshot()() || operation.current) return;
        operation.current = true;
        const valid = scope.begin();
        const input = payload();
        setBusy(true);
        try {
            const saved = await onSave();
            if (!valid() || saved.project_id !== project.project_id) return;
            const response = await uploadPlan(saved.project_id, input);
            if (!valid()) return;
            setPreparedPlan({ identity, value: response });
            setMessage(response.can_upload ? u.planReady : u.planWarnings, response.can_upload ? "success" : "warning");
        } catch (error) {
            if (valid()) setMessage(backendMessageText(error, lang.backendMessages), "error");
        } finally {
            if (valid()) {
                setBusy(false);
                operation.current = false;
            }
        }
    };

    const runUpload = async () => {
        if (!scope.snapshot()() || !project || !plan?.can_upload || operation.current) return;
        operation.current = true;
        const valid = scope.begin();
        setBusy(true);
        try {
            const response = await uploadRun(project.project_id, payload());
            if (!valid()) return;
            toastPubSub.pub({
                type: "success",
                text: response.message_message
                    ? backendMessageText(response.message_message, lang.backendMessages)
                    : response.message,
            });
        } catch (error) {
            if (valid()) setMessage(backendMessageText(error, lang.backendMessages), "error");
        } finally {
            if (valid()) {
                setBusy(false);
                operation.current = false;
            }
        }
    };

    const renderLrclibUpload = () => (
        <>
            {!project && <WarningText>{u.saveBeforePublish}</WarningText>}
            <FormGrid>
                <label>
                    {u.mode}
                    <select value={mode} onChange={(ev) => setMode(ev.target.value)}>
                        <option value="auto">{u.auto}</option>
                        <option value="mixed">{u.mixed}</option>
                        <option value="synced">{u.synced}</option>
                        <option value="plain">{u.plain}</option>
                        <option value="instrumental">{u.instrumental}</option>
                    </select>
                </label>
            </FormGrid>
            <ButtonGroup>
                <button type="button" disabled={busy || !project} onClick={makePlan}>{u.generatePlan}</button>
                <button type="button" disabled={busy || !project || !plan?.can_upload} onClick={runUpload}>
                    {u.confirmUpload}
                </button>
            </ButtonGroup>
            {plan && (
                <div className="studio-plan">
                    <KeyValueList>
                        <b>{u.canUpload}</b>
                        <span>{plan.can_upload ? u.yes : u.no}</span>
                        <b>{u.mode}</b>
                        <span>{modeLabels[plan.mode] || plan.mode}</span>
                        <b>{u.reason}</b>
                        <span>
                            {plan.reason_message
                                ? backendMessageText(plan.reason_message, lang.backendMessages)
                                : plan.reason}
                        </span>
                        <b>{u.plainLines}</b>
                        <span>{plan.plain_lines}</span>
                        <b>{u.syncedLines}</b>
                        <span>{plan.synced_lines}</span>
                    </KeyValueList>
                    {plan.warnings.length > 0 && (
                        <WarningText>
                            {u.warnings}: {(plan.warning_messages?.length
                                ? plan.warning_messages.map((warning) =>
                                    backendMessageText(warning, lang.backendMessages)
                                )
                                : plan.warnings).join(", ")}
                        </WarningText>
                    )}
                    <LogBlock>{JSON.stringify(plan.payload_preview, null, 2)}</LogBlock>
                </div>
            )}
        </>
    );

    const renderNeteaseUploadActions = ({ song }: NeteaseSearchRenderProps) => (
        <button
            type="button"
            onClick={() => window.open(song.wiki_url, "_blank", "noopener,noreferrer")}
        >
            {u.openWiki}
        </button>
    );

    const renderNeteaseUpload = () => (
        <NeteaseSearch
            panelSessionId={panelSessionId}
            workspaceId={workspaceId}
            defaultQuery=""
            meta={{
                track: editorMeta.track,
                artist: editorMeta.artist,
                album: editorMeta.album,
            }}
            onMessage={setMessage}
            renderResultActions={renderNeteaseUploadActions}
        />
    );

    return (
        <Panel title={u.uploadLyrics}>
            <Tabs
                ariaLabel="Upload destinations"
                items={[{ value: "lrclib", label: u.lrclib }, { value: "netease", label: u.netease }]}
                value={destination}
                onChange={setDestination}
            />
            {destination === "lrclib" ? renderLrclibUpload() : renderNeteaseUpload()}
            <Message message={message} type={messageType} fading={messageFading} messageKey={messageKey} />
        </Panel>
    );
};
