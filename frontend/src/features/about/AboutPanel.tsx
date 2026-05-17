import { useContext } from "react";
import type React from "react";
import { appContext, ChangBits } from "../../components/app.context.js";

export const AboutPanel: React.FC<{ open: boolean; onClose: () => void }> = ({ open, onClose }) => {
    if (!open) return null;

    const version = import.meta.env.app?.version || "dev";
    const { lang } = useContext(appContext, ChangBits.lang);
    const a = lang.about;
    const u = lang.ui;

    return (
        <div className="about-overlay" role="dialog" aria-modal="true" aria-label={`About ${lang.app?.name || "Rolling Pebble"}`}>
            <button className="about-backdrop" type="button" onClick={onClose} aria-label="Close about" />
            <section className="about-modal">
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
                    <p>{a.creditsText}</p>
                    <div className="about-links">
                        <a href="https://github.com/Harmonese/rollingpebble" target="_blank" rel="noreferrer">{lang.app?.name || "Rolling Pebble"}</a>
                        <a href="https://github.com/magic-akari/lrc-maker" target="_blank" rel="noreferrer">lrc-maker</a>
                        <a href="https://github.com/Harmonese/py-roller" target="_blank" rel="noreferrer">py-roller</a>
                        <a href="https://github.com/Harmonese/pylrclib" target="_blank" rel="noreferrer">pylrclib</a>
                        <a href="https://lrclib.net" target="_blank" rel="noreferrer">LRCLIB</a>
                    </div>
                </section>

                <section className="about-section">
                    <h3>{a.coreHotkeys}</h3>
                    <dl className="about-hotkeys">
                        <dt>Space</dt><dd>{a.hotkeySpace}</dd>
                        <dt>Delete / Backspace</dt><dd>{a.hotkeyDelete}</dd>
                        <dt>Ctrl/⌘ + Enter</dt><dd>{a.hotkeyPlay}</dd>
                        <dt>↑ / ↓</dt><dd>{a.hotkeyUpDown}</dd>
                        <dt>← / →</dt><dd>{a.hotkeyLeftRight}</dd>
                        <dt>+ / -</dt><dd>{a.hotkeyPlusMinus}</dd>
                    </dl>
                </section>

                <section className="about-section">
                    <h3>{a.rightsNote}</h3>
                    <p>{a.rightsNoteText}</p>
                </section>
            </section>
        </div>
    );
};
