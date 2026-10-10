import type { LyricsDocumentState } from "../../../domain/lyrics/lyricsDocument.js";
import { Button } from "../../../ui/index.js";

export const LyricMarks: React.FC<{
    marks: LyricsDocumentState["marks"];
    insert: (slot: number) => void;
    disabled: boolean;
    labels: Language["ui"];
}> = ({ marks, insert, disabled, labels: u }) => {
    if (!marks.length) return null;
    return (
        <div className="lyric-marks" role="group" aria-label={u.lyricMarks}>
            <div className="lyric-marks-buttons">
                {marks.map((mark, slot) => {
                    const digit = (slot + 1) % 10;
                    const shortcuts = slot < 10
                        ? ` · Alt/Option+${digit}: ${u.insertMarkedLine} · Ctrl/⌘+Shift+${digit}: ${u.clearLyricMark}`
                        : "";
                    const label = `${slot + 1}: ${mark.text}${shortcuts}`;
                    return (
                        <Button
                            className="lyric-mark-number"
                            key={mark.id}
                            tone="primary"
                            title={label}
                            aria-label={label}
                            disabled={disabled}
                            onClick={() => insert(slot)}
                        >
                            {slot + 1}
                        </Button>
                    );
                })}
            </div>
        </div>
    );
};
