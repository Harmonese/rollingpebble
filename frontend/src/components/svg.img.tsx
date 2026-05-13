const avatar = "./img/lrc-roller-avatar.webp";

export const LrcRollerSideMascot: React.FC = () => {
    return (
        <img
            className="roller-side-mascot roller-avatar-legacy"
            alt="LRC Roller"
            src={avatar}
            crossOrigin="anonymous"
        />
    );
};

export const LrcRollerEmptyState: React.FC = () => {
    return <div className="roller-empty-state" aria-label="No lyrics loaded" />;
};

export const LrcRollerLoading: React.FC = () => {
    return (
        <img
            className="roller-legacy-loading start-loading roller-avatar-legacy"
            alt="Loading LRC Roller"
            src={avatar}
            crossOrigin="anonymous"
        />
    );
};
