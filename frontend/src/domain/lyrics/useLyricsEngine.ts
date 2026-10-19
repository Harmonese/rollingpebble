import type { State as LrcState, TrimOptios } from "@lrc-maker/lrc-parser";
import { parser } from "@lrc-maker/lrc-parser";
import { useReducer } from "react";
import { identify, reconcileLines, type TranslatedLine } from "./translationDocument.js";

type InitArgs = Readonly<{
    text: string;
    options: TrimOptios;
    select: number;
}>;

export const enum ActionType {
    parse,
    refresh,
    next,
    time,
    info,
    select,
    deleteTime,
    getState,
    markLine,
    unmarkLine,
    insertMarkedLine,
    undoMarkedLine,
    deleteLine,
    selectPlaying,
    editLine,
    translate,
    restoreTranslation,
    undoParse,
    editPair,
}

export interface IState extends LrcState {
    readonly lyric: readonly TranslatedLine[];
    readonly targetLanguage?: string;
    readonly parseUndo?: IState;
    readonly marks: readonly { id: number; text: string }[];
    readonly nextMarkId: number;
    readonly insertHistory: readonly { lyric: LrcState["lyric"]; selectIndex: number }[];
    readonly currentTime: number;
    readonly currentIndex: number;
    readonly nextTime: number;
    readonly nextIndex: number;
    readonly selectIndex: number;
}

type Map$Type$Payload<T, U> = { [key in keyof T]: U extends key ? { type: key; payload: T[key] } : never }[keyof T];

export type Action = Map$Type$Payload<
    {
        [ActionType.parse]: {
            text: string;
            options: TrimOptios;
            preserveMarks?: boolean;
            preserveMetadata?: boolean;
            metadataOrigin?: "lyrics";
            preserveTranslation?: boolean;
            undoable?: boolean;
        };
        [ActionType.refresh]: number;
        [ActionType.next]: number;
        [ActionType.time]: number;
        [ActionType.info]: { name: string; value: string };
        [ActionType.select]: (index: number) => number;
        [ActionType.deleteTime]: undefined;
        [ActionType.getState]: (state: IState) => void;
        [ActionType.markLine]: { slot?: number };
        [ActionType.unmarkLine]: { slot?: number };
        [ActionType.insertMarkedLine]: { slot: number; time: number };
        [ActionType.undoMarkedLine]: undefined;
        [ActionType.deleteLine]: undefined;
        [ActionType.selectPlaying]: number;
        [ActionType.editLine]: { id: string; field: "text" | "translation"; value: string; target?: string };
        [ActionType.translate]: { lines: { id: string; text: string }[]; target: string };
        [ActionType.restoreTranslation]: { lines: TranslatedLine[]; target: string };
        [ActionType.undoParse]: undefined;
        [ActionType.editPair]: { lines: TranslatedLine[]; target: string };
    },
    ActionType
>;

export const guard = (value: number, min: number, max: number): number => {
    if (value < min) {
        return min;
    }
    if (value > max) {
        return max;
    }
    return value;
};

const mergeObject = <T extends O, O>(target: T, obj: O): T => {
    for (const i in obj) {
        if (target[i] !== obj[i]) {
            return { ...target, ...obj };
        }
    }

    return target;
};

export const reducer = (state: IState, action: Action): IState => {
    if (
        state.parseUndo
        && ![
            ActionType.undoParse,
            ActionType.select,
            ActionType.refresh,
            ActionType.getState,
            ActionType.markLine,
            ActionType.unmarkLine,
            ActionType.selectPlaying,
        ].includes(action.type)
    ) {
        state = { ...state, parseUndo: undefined };
    }
    switch (action.type) {
        case ActionType.editPair:
            if (
                action.payload.lines.length !== state.lyric.length
                || action.payload.lines.some((line, i) => line.id !== state.lyric[i].id)
            ) return state;
            return reducer({
                ...state,
                lyric: action.payload.lines,
                targetLanguage: action.payload.target,
                insertHistory: [],
                currentTime: Infinity,
                nextTime: -Infinity,
            }, { type: ActionType.refresh, payload: state.currentTime });
        case ActionType.undoParse:
            return state.parseUndo || state;
        case ActionType.restoreTranslation:
            return { ...state, lyric: action.payload.lines, targetLanguage: action.payload.target };
        case ActionType.editLine:
            return {
                ...state,
                targetLanguage: state.targetLanguage || action.payload.target,
                insertHistory: [],
                lyric: state.lyric.map(line =>
                    line.id !== action.payload.id ? line : {
                        ...line,
                        [action.payload.field]: action.payload.value.replace(/[\r\n]+/g, " "),
                        ...(action.payload.field === "translation" ? { source_text: line.text } : {}),
                    }
                ),
            };
        case ActionType.translate: {
            const values = new Map(action.payload.lines.map(line => [line.id, line.text]));
            return {
                ...state,
                targetLanguage: action.payload.target,
                insertHistory: [],
                lyric: state.lyric.map(line => ({
                    ...line,
                    ...(state.targetLanguage !== action.payload.target ? { translation: "", source_text: "" } : {}),
                    ...(values.has(line.id!) ? { translation: values.get(line.id!), source_text: line.text } : {}),
                })),
            };
        }
        case ActionType.parse: {
            const { text, options } = action.payload;
            const lrc = parser(text, options);
            const selectIndex = guard(state.selectIndex, 0, lrc.lyric.length);
            return {
                ...state,
                ...lrc,
                lyric: action.payload.preserveTranslation
                    ? reconcileLines(state.lyric, lrc.lyric).lines
                    : lrc.lyric.map(identify),
                targetLanguage: action.payload.preserveTranslation ? state.targetLanguage : "",
                parseUndo: action.payload.undoable ? state : undefined,
                info: action.payload.preserveMetadata ? new Map([...state.info, ...lrc.info]) : lrc.info,
                selectIndex,
                marks: action.payload.preserveMarks ? state.marks : [],
                insertHistory: [],
                currentTime: Infinity,
                nextTime: -Infinity,
            };
        }

        case ActionType.markLine: {
            const { slot } = action.payload;
            if (slot !== undefined && (!Number.isInteger(slot) || slot < 0)) return state;
            const text = state.lyric[state.selectIndex]?.text;
            if (!text?.trim() || state.marks.some((mark) => mark.text === text)) return state;
            const marks = [...state.marks];
            if (slot !== undefined && slot < marks.length) {
                marks[slot] = { ...marks[slot], text };
                return { ...state, marks };
            }
            marks.push({ id: state.nextMarkId, text });
            return { ...state, marks, nextMarkId: state.nextMarkId + 1 };
        }
        case ActionType.unmarkLine: {
            const slot = action.payload.slot
                ?? state.marks.findIndex((mark) => mark.text === state.lyric[state.selectIndex]?.text);
            if (!Number.isInteger(slot) || slot < 0 || slot >= state.marks.length) return state;
            return { ...state, marks: state.marks.filter((_, index) => index !== slot) };
        }
        case ActionType.insertMarkedLine: {
            const { slot, time } = action.payload;
            const text = state.marks[slot]?.text;
            if (!text || !Number.isFinite(time) || time < 0) return state;
            const lyric = [...state.lyric];
            const selectIndex = state.selectIndex + 1;
            const candidates = state.lyric.filter(line => line.text === text);
            const translation = candidates.length && candidates.every(line =>
                    line.translation
                    && line.source_text === text && line.translation === candidates[0].translation
                )
                ? candidates[0].translation
                : "";
            lyric.splice(
                state.selectIndex,
                0,
                identify({ text, time, translation, source_text: translation ? text : "" }),
            );
            return {
                ...state,
                lyric,
                selectIndex,
                currentTime: Infinity,
                nextTime: -Infinity,
                insertHistory: [...state.insertHistory.slice(-99), {
                    lyric: state.lyric,
                    selectIndex: state.selectIndex,
                }],
            };
        }
        case ActionType.deleteLine: {
            if (!state.lyric[state.selectIndex]) return state;
            return {
                ...state,
                lyric: state.lyric.filter((_, index) => index !== state.selectIndex),
                currentTime: Infinity,
                nextTime: -Infinity,
                insertHistory: [...state.insertHistory.slice(-99), {
                    lyric: state.lyric,
                    selectIndex: state.selectIndex,
                }],
            };
        }
        case ActionType.selectPlaying: {
            const refreshed = reducer({ ...state, currentTime: Infinity, nextTime: -Infinity }, {
                type: ActionType.refresh,
                payload: action.payload,
            });
            return Number.isFinite(refreshed.currentIndex)
                ? { ...refreshed, selectIndex: refreshed.currentIndex }
                : state;
        }
        case ActionType.undoMarkedLine: {
            const previous = state.insertHistory[state.insertHistory.length - 1];
            if (!previous) return state;
            return {
                ...state,
                ...previous,
                insertHistory: state.insertHistory.slice(0, -1),
                currentTime: Infinity,
                nextTime: -Infinity,
            };
        }

        case ActionType.refresh: {
            const audioTime = action.payload;
            if (audioTime >= state.currentTime && audioTime < state.nextTime) {
                return state;
            }

            const record = state.lyric.reduce(
                (p, c, i) => {
                    if (c.time !== undefined && Number.isFinite(c.time)) {
                        if (c.time < p.nextTime && c.time > audioTime) {
                            p.nextTime = c.time;
                            p.nextIndex = i;
                        }
                        if (c.time > p.currentTime && c.time <= audioTime) {
                            p.currentTime = c.time;
                            p.currentIndex = i;
                        }
                    }
                    return p;
                },
                {
                    currentTime: -Infinity,
                    currentIndex: -Infinity,
                    nextTime: Infinity,
                    nextIndex: Infinity,
                },
            );

            return mergeObject(state, record);
        }

        case ActionType.next: {
            const index = state.selectIndex;
            if (!state.lyric[index]) return state;

            const lyric = state.lyric;

            const selectIndex = guard(index + 1, 0, lyric.length);

            return {
                ...reducer(state, {
                    type: ActionType.time,
                    payload: action.payload,
                }),
                selectIndex,
            };
        }

        case ActionType.time: {
            const time = action.payload;
            const index = state.selectIndex;
            if (!state.lyric[index]) return state;

            let lyric = state.lyric;
            if (lyric[index].time !== time) {
                const newLyric = lyric.slice();
                newLyric[index] = { ...lyric[index], time };
                lyric = newLyric;
            }

            return { ...state, lyric, insertHistory: [], currentTime: time, nextTime: -Infinity };
        }

        case ActionType.info: {
            const { name, value } = action.payload;

            const info = new Map(state.info);
            if (value.trim() === "") {
                info.delete(name);
            } else {
                info.set(name, value.trim());
            }

            return {
                ...state,
                info,
            };
        }

        case ActionType.select: {
            const selectIndex = guard(action.payload(state.selectIndex), 0, state.lyric.length);
            return state.selectIndex === selectIndex ? state : { ...state, selectIndex };
        }

        case ActionType.deleteTime: {
            const { selectIndex, currentIndex } = state;

            let lyric = state.lyric;
            if (lyric[selectIndex]?.time !== undefined) {
                const newLyric = lyric.slice();
                newLyric[selectIndex] = { ...lyric[selectIndex], time: undefined };
                lyric = newLyric;

                let { currentTime, nextTime } = state;
                if (selectIndex === currentIndex) {
                    currentTime = Infinity;
                    nextTime = -Infinity;
                }

                return {
                    ...state,
                    lyric,
                    insertHistory: [],
                    currentTime,
                    nextTime,
                };
            }

            return state;
        }

        case ActionType.getState: {
            action.payload(state);
            return state;
        }
    }

    return state;
};

export const init = (lazyInit: () => InitArgs): IState => {
    const { text, options, select } = lazyInit();
    const parsed = parser(text, options);
    return {
        ...parsed,
        lyric: parsed.lyric.map(identify),
        targetLanguage: "",
        marks: [],
        nextMarkId: 0,
        insertHistory: [],
        currentTime: Infinity,
        currentIndex: Infinity,
        nextTime: -Infinity,
        nextIndex: -Infinity,
        selectIndex: guard(select, 0, parsed.lyric.length),
    };
};

export const useLrc = (lazyInit: () => InitArgs): [IState, React.Dispatch<Action>] =>
    useReducer(reducer, lazyInit, init);
