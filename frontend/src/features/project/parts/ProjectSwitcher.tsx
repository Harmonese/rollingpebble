export const ProjectSwitcher: React.FC<{
    currentIndex: number;
    total: number;
    labels: { previousProject: string; nextProject: string };
    onSwitch: (direction: -1 | 1) => void;
}> = ({ currentIndex, total, labels, onSwitch }) => (
    <div className="project-switcher">
        <button
            type="button"
            className="project-switcher-btn"
            aria-label={labels.previousProject}
            disabled={currentIndex <= 0}
            onClick={() => onSwitch(-1)}
        >
            ←
        </button>
        <span className="project-switcher-label">
            {currentIndex >= 0 ? `${currentIndex + 1} / ${total}` : "- / -"}
        </span>
        <button
            type="button"
            className="project-switcher-btn"
            aria-label={labels.nextProject}
            disabled={currentIndex < 0 || currentIndex >= total - 1}
            onClick={() => onSwitch(1)}
        >
            →
        </button>
    </div>
);
