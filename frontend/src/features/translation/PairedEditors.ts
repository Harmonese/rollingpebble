import { defaultKeymap } from "@codemirror/commands";
import { Annotation, EditorSelection, EditorState, StateEffect, StateField } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, keymap } from "@codemirror/view";
import type { TranslatedLine } from "../../domain/lyrics/translationDocument.js";
import {
    anchorTop,
    pairedHeights,
    pairedText,
    readPair,
    scrollAnchor,
    type Side,
    translationPaste,
} from "./pairedDocument.js";

const internal = Annotation.define<boolean>();
const decorate = StateEffect.define<DecorationSet>();
const decorationField = StateField.define({
    create: () => Decoration.none,
    update: (value, tr) => tr.effects.find(effect => effect.is(decorate))?.value ?? value.map(tr.changes),
    provide: field => EditorView.decorations.from(field),
});
type Snapshot = { texts: [string, string]; lines: TranslatedLine[]; target: string; selections: EditorSelection[] };
type Options = {
    lines: readonly TranslatedLine[];
    target: string;
    editTarget?: string;
    fixed: Fixed;
    stale: string;
    labels: [string, string];
    commit: (lines: TranslatedLine[], target: string) => void;
    select: (index: number) => void;
    error: (kind: "structure" | "timestamp" | null) => void;
    draft?: (texts: string[] | null) => void;
};

/** Two continuous documents. Layout decoration never changes clipboard text. */
export class PairedEditors {
    views: [EditorView, EditorView];
    private lines: TranslatedLine[];
    private target: string;
    private accepted: string;
    private heights: number[] = [];
    private undoStack: Snapshot[] = [];
    private redoStack: Snapshot[] = [];
    private frame = 0;
    private disposed = false;
    private updating = false;
    private active: Side = 0;
    private observers: ResizeObserver;
    private mirrors: [HTMLDivElement, HTMLDivElement];
    private fontsChanged = () => this.schedule();
    constructor(private hosts: [HTMLDivElement, HTMLDivElement], private options: Options) {
        this.lines = [...options.lines];
        this.target = options.target;
        this.accepted = JSON.stringify([this.lines, this.target]);
        this.mirrors = hosts.map(host => {
            const mirror = document.createElement("div");
            mirror.className = "translation-measure";
            mirror.setAttribute("aria-hidden", "true");
            host.append(mirror);
            return mirror;
        }) as [HTMLDivElement, HTMLDivElement];
        this.views = ([0, 1] as const).map(side =>
            new EditorView({
                parent: hosts[side],
                state: EditorState.create({
                    doc: pairedText(this.lines, side, options.fixed),
                    extensions: [
                        EditorView.lineWrapping,
                        decorationField,
                        EditorView.contentAttributes.of({
                            "aria-label": options.labels[side],
                            spellcheck: "false",
                            autocapitalize: "off",
                        }),
                        keymap.of([
                            { key: "Mod-z", run: () => this.undo(false), preventDefault: true },
                            { key: "Mod-Shift-z", run: () => this.undo(true), preventDefault: true },
                            { key: "Mod-y", run: () => this.undo(true), preventDefault: true },
                            ...defaultKeymap,
                        ]),
                        EditorState.transactionFilter.of(tr => {
                            if (!tr.docChanged || tr.annotation(internal)) return tr;
                            const value = tr.newDoc.toString();
                            const parsed = readPair(value, side, this.lines, this.options.fixed);
                            if (side === 1 && parsed.error === "timestamp" && tr.isUserEvent("input.paste")) {
                                const normalized = translationPaste(value, this.lines, this.options.fixed);
                                if (readPair(normalized, side, this.lines, this.options.fixed).lines) {
                                    return {
                                        changes: { from: 0, to: tr.startState.doc.length, insert: normalized },
                                        selection: EditorSelection.cursor(
                                            Math.min(
                                                tr.newSelection.main.head + normalized.length - value.length,
                                                normalized.length,
                                            ),
                                        ),
                                        userEvent: "input.paste",
                                    };
                                }
                            }
                            if (parsed.error === "structure" || (side === 1 && parsed.error)) {
                                queueMicrotask(() => {
                                    if (!this.disposed) this.options.error(parsed.error!);
                                });
                                return [];
                            }
                            // Empty documents have no editable placeholder lyric.
                            return tr;
                        }),
                        EditorView.updateListener.of(update => {
                            if (this.updating || !this.views) return;
                            if (update.selectionSet && update.view.hasFocus) {
                                this.active = side;
                                this.options.select(
                                    Math.min(
                                        this.lines.length,
                                        update.state.doc.lineAt(update.state.selection.main.head).number - 1,
                                    ),
                                );
                            }
                            if (!update.docChanged || update.transactions.every(tr => tr.annotation(internal))) return;
                            const snapshot = this.snapshot();
                            snapshot.texts[side] = update.startState.doc.toString();
                            snapshot.selections[side] = update.startState.selection;
                            this.undoStack.push(snapshot);
                            this.undoStack = this.undoStack.slice(-100);
                            this.redoStack = [];
                            const parsed = readPair(update.state.doc.toString(), side, this.lines, this.options.fixed);
                            if (parsed.lines) {
                                this.lines = parsed.lines;
                                if (side === 1 && !this.target && this.lines.some(line => line.translation)) {
                                    this.target = this.options.editTarget || "";
                                }
                                this.accept();
                                this.options.error(null);
                                // Rebuild the follower only when source timestamps actually changed.
                                if (side === 0) this.replace(1, pairedText(this.lines, 1, this.options.fixed));
                            }
                            this.options.draft?.(
                                this.validate(false) ? null : this.views.map(view => view.state.doc.toString()),
                            );
                            this.schedule();
                        }),
                        EditorView.domEventHandlers({
                            focus: (_, view) => {
                                this.active = side;
                                this.options.select(
                                    Math.min(
                                        this.lines.length,
                                        view.state.doc.lineAt(view.state.selection.main.head).number - 1,
                                    ),
                                );
                            },
                            blur: () => {
                                this.validate(false);
                            },
                            scroll: (_, view) => {
                                if (this.updating) return;
                                const other = this.views[side === 0 ? 1 : 0].scrollDOM;
                                if (Math.abs(other.scrollTop - view.scrollDOM.scrollTop) > 1) {
                                    other.scrollTop = view.scrollDOM.scrollTop;
                                }
                            },
                        }),
                    ],
                }),
            })
        ) as [EditorView, EditorView];
        this.observers = new ResizeObserver(() => this.schedule());
        hosts.forEach(host => this.observers.observe(host));
        document.fonts?.ready.then(() => this.schedule());
        document.fonts?.addEventListener("loadingdone", this.fontsChanged);
        this.schedule();
    }
    private snapshot(): Snapshot {
        return {
            texts: this.views.map(view => view.state.doc.toString()) as [string, string],
            lines: [...this.lines],
            target: this.target,
            selections: this.views.map(view => view.state.selection),
        };
    }
    private accept() {
        this.accepted = JSON.stringify([this.lines, this.target]);
        this.options.commit(this.lines, this.target);
    }
    private replace(side: Side, text: string, selection?: EditorSelection) {
        const view = this.views[side];
        if (view.state.doc.toString() === text && !selection) return;
        view.dispatch({
            changes: { from: 0, to: view.state.doc.length, insert: text },
            annotations: internal.of(true),
            selection: selection || EditorSelection.cursor(Math.min(view.state.selection.main.head, text.length)),
        });
    }
    undo(redo: boolean) {
        const from = redo ? this.redoStack : this.undoStack;
        const next = from.pop();
        if (!next) return true;
        (redo ? this.undoStack : this.redoStack).push(this.snapshot());
        this.updating = true;
        this.lines = next.lines;
        this.target = next.target;
        this.replace(0, next.texts[0], next.selections[0]);
        this.replace(1, next.texts[1], next.selections[1]);
        this.updating = false;
        this.accept();
        const focused = this.views[this.active];
        this.options.select(
            Math.min(this.lines.length, focused.state.doc.lineAt(focused.state.selection.main.head).number - 1),
        );
        this.validate();
        this.schedule();
        return true;
    }
    validate(focus = true) {
        const parsed = readPair(this.views[0].state.doc.toString(), 0, this.lines, this.options.fixed);
        this.options.error(parsed.error || null);
        if (parsed.error && focus) this.views[0].focus();
        return !parsed.error;
    }
    update(options: Options) {
        // Changing display preferences must not discard an unfinished timestamp.
        if (
            JSON.stringify(options.lines) === JSON.stringify(this.lines)
            && readPair(this.views[0].state.doc.toString(), 0, this.lines, this.options.fixed).error
        ) {
            this.options = { ...options, fixed: this.options.fixed };
            return;
        }
        const fixedChanged = options.fixed !== this.options.fixed;
        const staleChanged = options.stale !== this.options.stale;
        this.options = options;
        const signature = JSON.stringify([options.lines, options.target]);
        if (signature !== this.accepted || fixedChanged) {
            this.updating = true;
            this.lines = [...options.lines];
            this.target = options.target;
            this.accepted = signature;
            this.undoStack = [];
            this.redoStack = [];
            this.replace(0, pairedText(this.lines, 0, options.fixed));
            this.replace(1, pairedText(this.lines, 1, options.fixed));
            this.updating = false;
            this.options.error(null);
            this.schedule();
        } else if (staleChanged) this.schedule();
    }
    private schedule() {
        if (this.disposed || this.frame) return;
        this.frame = requestAnimationFrame(() => {
            this.frame = 0;
            this.measure();
        });
    }
    private measure() {
        if (this.disposed || !this.hosts[0].clientWidth) return;
        const anchor = scrollAnchor(this.heights, this.views[this.active].scrollDOM.scrollTop);
        // Measure every logical line, including outside CodeMirror's viewport.
        // Fixed pixel heights then keep both virtual height maps identical.
        const nodes = this.views.map((view, side) => {
            const mirror = this.mirrors[side];
            mirror.style.width = `${view.contentDOM.clientWidth}px`;
            const style = getComputedStyle(view.contentDOM);
            mirror.style.font = style.font;
            mirror.style.lineHeight = style.lineHeight;
            const fragment = document.createDocumentFragment();
            for (let n = 1; n <= view.state.doc.lines; n++) {
                const line = document.createElement("div");
                line.className = "cm-line";
                line.textContent = view.state.doc.line(n).text || "\u200b";
                fragment.append(line);
            }
            mirror.replaceChildren(fragment);
            return [...mirror.children] as HTMLElement[];
        });
        const heights = pairedHeights(
            nodes[0].map(node => node.getBoundingClientRect().height),
            nodes[1].map(node => node.getBoundingClientRect().height),
        );
        this.updating = true;
        this.views.forEach((view, side) => {
            const ranges = heights.map((height, i) => {
                const line = this.lines[i];
                const stale = side === 1 && line?.translation && line.source_text !== line.text;
                return Decoration.line({
                    attributes: {
                        style: `min-height:${height}px`,
                        ...(stale ? { class: "translation-stale", title: this.options.stale } : {}),
                    },
                })
                    .range(view.state.doc.line(i + 1).from);
            });
            view.dispatch({ effects: decorate.of(Decoration.set(ranges)) });
        });
        const top = this.heights.length ? anchorTop(heights, anchor) : this.views[this.active].scrollDOM.scrollTop;
        this.heights = heights;
        this.views.forEach(view => {
            view.scrollDOM.scrollTop = top;
            view.requestMeasure();
        });
        this.updating = false;
    }
    destroy() {
        this.disposed = true;
        cancelAnimationFrame(this.frame);
        this.observers.disconnect();
        document.fonts?.removeEventListener("loadingdone", this.fontsChanged);
        this.views.forEach(view => view.destroy());
        this.mirrors.forEach(mirror => mirror.remove());
    }
}
