import { PreferencesSVG } from "./svg.js";

export const Header: React.FC<{ onSettings: () => void }> = ({ onSettings }) => {
    return (
        <header className="app-header">
            <a className="app-title" title="lrc-roller" href="#">
                <span className="app-title-text">lrc-roller</span>
            </a>
            <nav className="app-nav" aria-label="Application settings">
                <button className="app-tab icon-tab" title="Settings" type="button" onClick={onSettings}>
                    <PreferencesSVG />
                </button>
            </nav>
        </header>
    );
};
