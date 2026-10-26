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
        className="studio-app-loading start-loading"
        alt={label}
        src="/img/rollingpebble-icon.png"
        crossOrigin="anonymous"
    />
);

export const StartupMark: React.FC<{ active?: boolean }> = ({ active = true }) => (
    <div className="startup-mark" data-active={active} aria-hidden="true">
        <span className="startup-mark-halo" />
        <span className="startup-mark-orbit startup-mark-orbit-outer" />
        <span className="startup-mark-orbit startup-mark-orbit-inner" />
        <img className="startup-mark-icon" src="/img/rollingpebble-icon.png" alt="" width="512" height="512" />
        <span className="startup-mark-wave">
            {Array.from({ length: 9 }, (_, index) => <span key={index} />)}
        </span>
    </div>
);
