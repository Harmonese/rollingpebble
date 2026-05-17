import { useContext } from "react";
import { appContext } from "./app.context.js";

const avatar = "./img/rollingpebble-avatar.webp";

export const LrcRollerSideMascot: React.FC = () => {
    const { lang } = useContext(appContext);
    return (
        <img
            className="roller-side-mascot roller-avatar-legacy"
            alt={lang.app?.name || "Rolling Pebble"}
            src={avatar}
            crossOrigin="anonymous"
        />
    );
};

export const LrcRollerEmptyState: React.FC = () => {
    return <div className="roller-empty-state" aria-label="No lyrics loaded" />;
};

export const LrcRollerLoading: React.FC = () => {
    const { lang } = useContext(appContext);
    return (
        <img
            className="roller-legacy-loading start-loading roller-avatar-legacy"
            alt={`Loading ${lang.app?.name || "Rolling Pebble"}`}
            src={avatar}
            crossOrigin="anonymous"
        />
    );
};
