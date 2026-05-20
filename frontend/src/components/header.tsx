import { useContext } from "react";
import { appContext } from "./app.context.js";
import { InfoSVG, PreferencesSVG } from "./svg.js";

export const Header: React.FC<{ onAbout: () => void; onSettings: () => void }> = ({ onAbout, onSettings }) => {
    const { lang } = useContext(appContext);
    const appName = lang.app?.name || "Rolling Pebble";
    const navLabel = lang.header?.preferences || lang.ui.settings;
    const aboutLabel = lang.ui.about;
    const settingsLabel = lang.ui.settings;
    return (
        <header className="app-header">
            <div className="app-title" title={appName}>
                <span className="app-title-text">{appName}</span>
            </div>
            <nav className="app-nav" aria-label={navLabel}>
                <button className="app-tab icon-tab" title={aboutLabel} aria-label={aboutLabel} type="button" onClick={onAbout}><InfoSVG /></button>
                <button className="app-tab icon-tab" title={settingsLabel} aria-label={settingsLabel} type="button" onClick={onSettings}>
                    <PreferencesSVG />
                </button>
            </nav>
        </header>
    );
};
