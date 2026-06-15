const avatar = "./img/rollingpebble-avatar.webp";

export const LrcRollerSideMascot: React.FC<{ label: string }> = ({ label }) => (
    <img
        className="studio-side-mascot studio-avatar"
        alt={label}
        src={avatar}
        crossOrigin="anonymous"
    />
);

export const LrcRollerEmptyState: React.FC<{ label: string }> = ({ label }) => (
    <div className="studio-empty-state" aria-label={label} />
);

export const LrcRollerLoading: React.FC<{ label: string }> = ({ label }) => (
    <img
        className="studio-app-loading start-loading studio-avatar"
        alt={label}
        src={avatar}
        crossOrigin="anonymous"
    />
);
