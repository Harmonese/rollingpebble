import type React from "react";

export const MutedText: React.FC<React.HTMLAttributes<HTMLParagraphElement>> = ({ className = "", ...props }) => (
    <p className={["ui-muted", className].filter(Boolean).join(" ")} {...props} />
);

export const WarningText: React.FC<React.HTMLAttributes<HTMLParagraphElement>> = ({ className = "", ...props }) => (
    <p className={["ui-warning", className].filter(Boolean).join(" ")} {...props} />
);

export const KeyValueList: React.FC<React.HTMLAttributes<HTMLDivElement> & { compact?: boolean }> = (
    { compact = false, className = "", ...props },
) => <div className={["ui-kv", compact ? "compact" : "", className].filter(Boolean).join(" ")} {...props} />;

export const InputStatusGroup: React.FC<React.HTMLAttributes<HTMLDivElement>> = ({ className = "", ...props }) => (
    <div className={["ui-input-status", className].filter(Boolean).join(" ")} {...props} />
);
