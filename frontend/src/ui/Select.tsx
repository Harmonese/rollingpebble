import type React from "react";

export const Select: React.FC<React.SelectHTMLAttributes<HTMLSelectElement>> = ({ className = "", ...props }) => (
    <select className={["ui-select", className].filter(Boolean).join(" ")} {...props} />
);
