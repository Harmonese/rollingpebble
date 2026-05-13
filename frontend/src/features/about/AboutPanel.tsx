import type React from "react";

export const AboutPanel: React.FC<{ open: boolean; onClose: () => void }> = ({ open, onClose }) => {
    if (!open) return null;

    const version = import.meta.env.app?.version || "0.4.0";

    return (
        <div className="about-overlay" role="dialog" aria-modal="true" aria-label="About LRC Roller">
            <button className="about-backdrop" type="button" onClick={onClose} aria-label="Close about" />
            <section className="about-modal">
                <div className="about-header">
                    <div>
                        <p className="about-kicker">About</p>
                        <h2>LRC Roller</h2>
                        <p className="about-tagline">A local workflow app for importing, timing, editing, and publishing synced lyrics.</p>
                    </div>
                    <button type="button" onClick={onClose}>Close</button>
                </div>

                <div className="about-version">Version {version}</div>

                <section className="about-section">
                    <h3>What it does</h3>
                    <p>
                        LRC Roller combines lyrics import, automatic timing, manual correction, cleanup, export,
                        and LRCLIB publishing in a local WebUI. Audio processing and Auto Timing run locally.
                    </p>
                </section>

                <section className="about-section">
                    <h3>Features</h3>
                    <ul>
                        <li>Import lyrics from LRCLIB or local .lrc / .txt files.</li>
                        <li>Create a single-song project from a local audio file.</li>
                        <li>Generate synced lyrics with Auto Timing and correct them manually.</li>
                        <li>Clean selected LRC issues and publish to LRCLIB.</li>
                    </ul>
                </section>

                <section className="about-section">
                    <h3>Credits</h3>
                    <p>
                        The synchronizer and editor experience is based on magic-akari/lrc-maker. Auto Timing is powered
                        by Harmonese/py-roller, and LRCLIB integration is powered by Harmonese/pylrclib.
                    </p>
                    <div className="about-links">
                        <a href="https://github.com/Harmonese/lrc-roller" target="_blank" rel="noreferrer">LRC Roller</a>
                        <a href="https://github.com/magic-akari/lrc-maker" target="_blank" rel="noreferrer">lrc-maker</a>
                        <a href="https://github.com/Harmonese/py-roller" target="_blank" rel="noreferrer">py-roller</a>
                        <a href="https://github.com/Harmonese/pylrclib" target="_blank" rel="noreferrer">pylrclib</a>
                        <a href="https://lrclib.net" target="_blank" rel="noreferrer">LRCLIB</a>
                    </div>
                </section>

                <section className="about-section">
                    <h3>Core hotkeys</h3>
                    <dl className="about-hotkeys">
                        <dt>Space</dt><dd>Insert timestamp</dd>
                        <dt>Delete / Backspace</dt><dd>Remove timestamp</dd>
                        <dt>Ctrl/⌘ + Enter</dt><dd>Play / pause</dd>
                        <dt>↑ / ↓</dt><dd>Previous / next line</dd>
                        <dt>← / →</dt><dd>Step audio backward / forward</dd>
                        <dt>+ / -</dt><dd>Adjust selected timestamp</dd>
                    </dl>
                </section>

                <section className="about-section">
                    <h3>Rights note</h3>
                    <p>Please make sure you have the rights to submit or publish lyrics, and respect each lyrics source and platform.</p>
                </section>
            </section>
        </div>
    );
};
