import { useContext } from "react";
import type React from "react";
import { appContext, AppContextBits } from "../../shared/appContext.js";
import { Modal } from "../../ui/Modal.js";

export const AboutPanel: React.FC<{ open: boolean; onClose: () => void }> = ({ open, onClose }) => {
    const version = import.meta.env.app?.version || "dev";
    const { lang } = useContext(appContext, AppContextBits.lang);
    const a = lang.about;
    const u = lang.ui;

    return (
        <Modal
            open={open}
            onClose={onClose}
            ariaLabel={`About ${lang.app?.name || "Rolling Pebble"}`}
            closeLabel={u.close}
            exitMs={200}
        >
            <div className="about-header">
                <div>
                    <p className="about-kicker">{a.kicker}</p>
                    <h2>{a.title}</h2>
                    <p className="about-tagline">{a.tagline}</p>
                </div>
                <button type="button" onClick={onClose} autoFocus>{u.close}</button>
            </div>

            <div className="about-version">{a.version.replace("{v}", version)}</div>

            <section className="about-section">
                <h3>{a.whatItDoes}</h3>
                <p>{a.whatItDoesText}</p>
            </section>

            <section className="about-section">
                <h3>{a.features}</h3>
                <ul>
                    <li>{a.feature1}</li>
                    <li>{a.feature2}</li>
                    <li>{a.feature3}</li>
                    <li>{a.feature4}</li>
                </ul>
            </section>

            <section className="about-section">
                <h3>{a.credits}</h3>
                <p>{a.authorText}</p>
                <p>{a.creditsText}</p>
                <div className="about-links about-links-row">
                    <a href="https://harmonese.cn" target="_blank" rel="noreferrer">{a.authorWebsite}</a>
                    <a href="https://github.com/Harmonese" target="_blank" rel="noreferrer">{a.authorGithub}</a>
                    <a href="https://harmonese.bandcamp.com" target="_blank" rel="noreferrer">{a.authorMusic}</a>
                </div>
                <div className="about-links about-links-row">
                    <a href="https://github.com/Harmonese/rollingpebble" target="_blank" rel="noreferrer">
                        {lang.app?.name || "Rolling Pebble"}
                    </a>
                    <a href="https://github.com/magic-akari/lrc-maker" target="_blank" rel="noreferrer">lrc-maker</a>
                    <a href="https://github.com/Harmonese/py-roller" target="_blank" rel="noreferrer">py-roller</a>
                    <a href="https://github.com/Harmonese/pylrclib" target="_blank" rel="noreferrer">pylrclib</a>
                    <a href="https://lrclib.net" target="_blank" rel="noreferrer">LRCLIB</a>
                </div>
            </section>

            <section className="about-section">
                <h3>{a.coreHotkeys}</h3>
                <dl className="about-hotkeys">
                    <dt>Space</dt>
                    <dd>{a.hotkeySpace}</dd>
                    <dt>Delete / Backspace</dt>
                    <dd>{a.hotkeyDelete}</dd>
                    <dt>1</dt>
                    <dd>{a.hotkeySelectPlaying}</dd>
                    <dt>0</dt>
                    <dd>{a.hotkeySeekSelected}</dd>
                    <dt>Alt/Option + 1–9, 0</dt>
                    <dd>{u.markCurrentLine}</dd>
                    <dt>Ctrl/⌘ + 1–9, 0</dt>
                    <dd>{u.insertMarkedLine}</dd>
                    <dt>Ctrl/⌘ + Shift + 1–9, 0</dt>
                    <dd>{u.clearLyricMark}</dd>
                    <dt>Ctrl/⌘ + Delete / Backspace</dt>
                    <dd>{a.hotkeyDeleteLine}</dd>
                    <dt>Ctrl/⌘ + Z</dt>
                    <dd>{lang.ui.undoMarkedLine}</dd>
                    <dt>Ctrl/⌘ + Enter</dt>
                    <dd>{a.hotkeyPlay}</dd>
                    <dt>↑ / ↓ · W / S · J / K</dt>
                    <dd>{a.hotkeyUpDown}</dd>
                    <dt>Home / End</dt>
                    <dd>{a.hotkeyFirstLast}</dd>
                    <dt>Page Up / Page Down</dt>
                    <dd>{a.hotkeyPage}</dd>
                    <dt>← / → · A / D · H / L</dt>
                    <dd>{a.hotkeyLeftRight} · 5s</dd>
                    <dt>Alt/Option + ← / →</dt>
                    <dd>{a.hotkeyLeftRight} · 1s</dd>
                    <dt>Shift + ← / →</dt>
                    <dd>{a.hotkeyLeftRight} · 2.5s</dd>
                    <dt>Alt/Option + Shift + ← / →</dt>
                    <dd>{a.hotkeyLeftRight} · 0.5s</dd>
                    <dt>- / =</dt>
                    <dd>{a.hotkeyPlusMinus} · ±0.5s</dd>
                    <dt>Alt/Option + - / =</dt>
                    <dd>{a.hotkeyPlusMinus} · ±0.1s</dd>
                    <dt>Shift + - / =</dt>
                    <dd>{a.hotkeyPlusMinus} · ±0.25s</dd>
                    <dt>Alt/Option + Shift + - / =</dt>
                    <dd>{a.hotkeyPlusMinus} · ±0.05s</dd>
                    <dt>Ctrl/⌘ + ↑ / ↓ · Ctrl/⌘ + J / K</dt>
                    <dd>{a.hotkeyRate}</dd>
                    <dt>R</dt>
                    <dd>{a.hotkeyResetRate}</dd>
                </dl>
            </section>

            <section className="about-section">
                <h3>{a.rightsNote}</h3>
                <p>{a.rightsNoteText}</p>
            </section>
        </Modal>
    );
};
