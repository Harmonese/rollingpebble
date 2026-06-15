import type React from "react";

export const FormGrid: React.FC<React.HTMLAttributes<HTMLDivElement> & { columns?: 1 | 2 }> = (
    { columns = 1, className = "", ...props },
) => (
    <div
        className={["ui-form-grid", columns === 2 ? "two-col" : "", className].filter(Boolean).join(" ")}
        {...props}
    />
);

export const ButtonGroup: React.FC<React.HTMLAttributes<HTMLDivElement> & { compact?: boolean }> = (
    { compact = false, className = "", ...props },
) => (
    <div
        className={["ui-button-group", compact ? "compact" : "", className].filter(Boolean).join(" ")}
        {...props}
    />
);
