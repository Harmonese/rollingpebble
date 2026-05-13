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
    return (
        <img
            className="roller-empty-illustration roller-avatar-legacy"
            alt="LRC Roller empty state"
            src={avatar}
            crossOrigin="anonymous"
        />
    );
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
