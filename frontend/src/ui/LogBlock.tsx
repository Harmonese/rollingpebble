import type React from "react";

export const LogBlock: React.FC<React.HTMLAttributes<HTMLPreElement>> = ({ className = "", ...props }) => (
    <pre className={["ui-log-block", className].filter(Boolean).join(" ")} {...props} />
);

export const CommandBlock: React.FC<React.HTMLAttributes<HTMLPreElement>> = ({ className = "", ...props }) => (
    <pre className={["ui-command-block", className].filter(Boolean).join(" ")} {...props} />
);
