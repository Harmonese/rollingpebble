import { useContext } from "react";
import { appContext } from "./app.context.js";
import { InfoSVG, PreferencesSVG } from "./svg.js";

export const Header: React.FC<{ onAbout: () => void; onSettings: () => void }> = ({ onAbout, onSettings }) => {
    const { lang } = useContext(appContext);
    const appName = lang.app?.name || "Rolling Pebble";
    return (
        <header className="app-header">
            <a className="app-title" title={appName} href="#">
                <span className="app-title-text">{appName}</span>
            </a>
            <nav className="app-nav" aria-label="Application settings">
                <button className="app-tab icon-tab" title="About" aria-label="About" type="button" onClick={onAbout}><InfoSVG /></button>
                <button className="app-tab icon-tab" title="Settings" aria-label="Settings" type="button" onClick={onSettings}>
                    <PreferencesSVG />
                </button>
            </nav>
        </header>
    );
};
