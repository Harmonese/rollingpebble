import type React from "react";

export const Input: React.FC<React.InputHTMLAttributes<HTMLInputElement>> = ({ className = "", ...props }) => (
    <input className={["ui-input", className].filter(Boolean).join(" ")} {...props} />
);
