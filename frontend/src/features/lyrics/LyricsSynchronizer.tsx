import SSK from "#const/session_key.json" with { type: "json" };
import STRINGS from "#const/strings.json" with { type: "json" };
import {
    convertTimeToTag,
    formatText,
    type LyricsDocumentAction as Action,
    LyricsDocumentActionType as ActionType,
    type LyricsDocumentLine as ILyric,
    type LyricsDocumentState as IState,
} from "../../domain/lyrics/lyricsDocument.js";
import { memo, useCallback, useContext, useEffect, useRef, useState } from "react";
import { useKeyBindings } from "../../hooks/useKeyBindings.js";
import type { PreferenceState as PrefState } from "../../shared/preferences.js";
import { currentTimePubSub } from "../../shared/audioPlaybackEvents.js";
import { useAudio } from "../../hooks/useAudio.js";
import { InputAction } from "../../utils/input-action.js";
import { isKeyboardElement } from "../../utils/is-keyboard-element.js";
import { getMatchedAction } from "../../utils/keybindings.js";
import { readSessionText, writeSessionText } from "../../storage/browserStorage.js";
import { appContext, AppContextBits } from "../../shared/appContext.js";
import { AsidePanel } from "./parts/AsidePanel.js";
import { PlaybackCursor } from "./parts/PlaybackCursor.js";
import { SyncMode } from "./syncMode.js";

const SpaceButton: React.FC<{ sync: () => void; label: string }> = ({ sync, label }) => {
    return (
        <button className="space-button" type="button" aria-label={label} title={label} onClick={sync}>
            {label}
        </button>
    );
};

interface ISynchronizerProps {
    state: IState;
    dispatch: React.Dispatch<Action>;
}

export const LyricsSynchronizer: React.FC<ISynchronizerProps> = ({ state, dispatch }) => {
    const audio = useAudio();
    const self = useRef(Symbol(LyricsSynchronizer.name));

    const { selectIndex, currentIndex: highlightIndex, lyric } = state;

    const { prefState, lang } = useContext(appContext, AppContextBits.prefState | AppContextBits.lang);
    const keyBindings = useKeyBindings();

    useEffect(() => {
        dispatch({
            type: ActionType.info,
            payload: {
                name: "tool",
                value: "Rolling Pebble https://github.com/Harmonese/rollingpebble",
            },
        });
    }, [dispatch, lang]);

    const [syncMode, setSyncMode] = useState(() =>
        readSessionText(SSK.syncMode) === SyncMode.highlight.toString() ? SyncMode.highlight : SyncMode.select
    );

    useEffect(() => {
        writeSessionText(SSK.syncMode, syncMode.toString());
    }, [syncMode]);

    const ul = useRef<HTMLUListElement>(null);

    const needScrollLine = {
        [SyncMode.select]: selectIndex,
        [SyncMode.highlight]: highlightIndex,
    }[syncMode];

    useEffect(() => {
        const line = ul.current?.children[needScrollLine];
        if (line !== undefined) {
            line.scrollIntoView({
                behavior: "smooth",
                block: "center",
                inline: "center",
            });
        }
    }, [needScrollLine]);

    useEffect(() => {
        return currentTimePubSub.sub(self.current, (time) => {
            dispatch({ type: ActionType.refresh, payload: time });
        });
    }, [dispatch]);

    const sync = useCallback(() => {
        if (!audio.duration) {
            return;
        }

        dispatch({
            type: ActionType.next,
            payload: audio.currentTime,
        });
    }, [dispatch]);

    const adjust = useCallback(
        (ev: KeyboardEvent | React.MouseEvent, offset: number, index: number) => {
            if (!audio.duration) {
                return;
            }

            const selectTime = lyric[index]?.time;

            if (selectTime === undefined) {
                return;
            }

            dispatch({
                type: ActionType.time,
                payload: audio.step(ev, offset, selectTime),
            });
        },
        [dispatch, lyric],
    );

    useEffect(() => {
        function onKeydown(ev: KeyboardEvent): void {
            if (isKeyboardElement(ev.target)) {
                return;
            }

            const action = getMatchedAction(ev, keyBindings);

            switch (action) {
                case InputAction.Sync:
                    ev.preventDefault();
                    sync();
                    break;
                case InputAction.DeleteTime:
                    ev.preventDefault();
                    dispatch({ type: ActionType.deleteTime, payload: undefined });
                    break;
                case InputAction.ResetOffset:
                    ev.preventDefault();
                    adjust(ev, 0, selectIndex);
                    break;
                case InputAction.DecreaseOffset:
                    ev.preventDefault();
                    adjust(ev, -0.5, selectIndex);
                    break;
                case InputAction.IncreaseOffset:
                    ev.preventDefault();
                    adjust(ev, 0.5, selectIndex);
                    break;
                case InputAction.PrevLine:
                    ev.preventDefault();
                    dispatch({ type: ActionType.select, payload: (index) => index - 1 });
                    break;
                case InputAction.NextLine:
                    ev.preventDefault();
                    dispatch({ type: ActionType.select, payload: (index) => index + 1 });
                    break;
                case InputAction.FirstLine:
                    ev.preventDefault();
                    dispatch({ type: ActionType.select, payload: () => 0 });
                    break;
                case InputAction.LastLine:
                    ev.preventDefault();
                    dispatch({ type: ActionType.select, payload: () => Infinity });
                    break;
                case InputAction.PageUp:
                    ev.preventDefault();
                    dispatch({ type: ActionType.select, payload: (index) => index - 10 });
                    break;
                case InputAction.PageDown:
                    ev.preventDefault();
                    dispatch({ type: ActionType.select, payload: (index) => index + 10 });
                    break;
            }
        }

        document.addEventListener("keydown", onKeydown);

        return (): void => {
            document.removeEventListener("keydown", onKeydown);
        };
    }, [adjust, dispatch, keyBindings, selectIndex, sync]);

    const onLineClick = useCallback(
        (ev: React.MouseEvent<HTMLUListElement & HTMLLIElement>) => {
            ev.stopPropagation();

            const target = ev.target as HTMLElement;

            if (target.classList.contains("line")) {
                const lineKey = Number.parseInt(target.dataset.key!, 10) || 0;

                dispatch({ type: ActionType.select, payload: () => lineKey });
            }
        },
        [dispatch],
    );

    const onLineDoubleClick = useCallback(
        (ev: React.MouseEvent<HTMLUListElement | HTMLLIElement>) => {
            ev.stopPropagation();

            if (!audio.duration) {
                return;
            }

            const target = ev.target as HTMLElement;

            if (target.classList.contains("line")) {
                const key = Number.parseInt(target.dataset.key!, 10);

                adjust(ev, 0, key);
            }
        },
        [adjust],
    );

    const LyricLineIter = useCallback(
        (line: Readonly<ILyric>, index: number, lines: readonly ILyric[]) => {
            const select = index === selectIndex;
            const highlight = index === highlightIndex;
            const error = index > 0 && lines[index].time! <= lines[index - 1].time!;

            const className = Object.entries({
                line: true,
                select,
                highlight,
                error,
            })
                .reduce<string[]>((p, [name, value]) => {
                    if (value) {
                        p.push(name);
                    }
                    return p;
                }, [])
                .join(STRINGS.space);

            return (
                <LyricLine
                    key={index}
                    index={index}
                    className={className}
                    line={line}
                    select={select}
                    prefState={prefState}
                />
            );
        },
        [selectIndex, highlightIndex, prefState],
    );

    const ulClassName = prefState.screenButton ? "lyric-list on-screen-button" : "lyric-list";

    return (
        <>
            <ul ref={ul} className={ulClassName} onClickCapture={onLineClick} onDoubleClickCapture={onLineDoubleClick}>
                {state.lyric.map(LyricLineIter)}
            </ul>
            <AsidePanel syncMode={syncMode} setSyncMode={setSyncMode} lrcDispatch={dispatch} prefState={prefState} />
            {prefState.screenButton && <SpaceButton sync={sync} label={lang.ui.spaceKey} />}
        </>
    );
};

interface ILyricLineProps {
    line: ILyric;
    index: number;
    select: boolean;
    className: string;
    prefState: PrefState;
}

const LyricLine: React.FC<ILyricLineProps> = memo(({ line, index, select, className, prefState }) => {
    const lineTime = convertTimeToTag(line.time, prefState.fixed);

    const lineText = formatText(line.text, prefState.spaceStart, prefState.spaceEnd);

    return (
        <li key={index} data-key={index} className={className}>
            {select && <PlaybackCursor fixed={prefState.fixed} />}
            <time className="line-time">{lineTime}</time>
            <span className="line-text">{lineText}</span>
        </li>
    );
}, (prev, next) => {
    return prev.line === next.line
        && prev.index === next.index
        && prev.select === next.select
        && prev.className === next.className
        && prev.prefState.fixed === next.prefState.fixed
        && prev.prefState.spaceStart === next.prefState.spaceStart
        && prev.prefState.spaceEnd === next.prefState.spaceEnd;
});
