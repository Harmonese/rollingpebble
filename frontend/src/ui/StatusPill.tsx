type StatusTone = "neutral" | "ok" | "warning" | "danger" | "info";

export const StatusPill: React.FC<React.HTMLAttributes<HTMLSpanElement> & { tone?: StatusTone }> = (
    { tone = "neutral", className = "", ...props },
) => <span className={`ui-status-pill ui-status-${tone}${className ? ` ${className}` : ""}`} {...props} />;
