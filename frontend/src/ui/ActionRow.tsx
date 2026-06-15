import type React from "react";

export const ActionRow: React.FC<{
    title: string;
    description?: string;
    className?: string;
    children: React.ReactNode;
}> = ({ title, description, className = "", children }) => (
    <div className={["ui-action-row", className].filter(Boolean).join(" ")}>
        <div className="ui-action-main">
            <b>{title}</b>
            {description && <small>{description}</small>}
        </div>
        <div className="ui-action-buttons">
            {children}
        </div>
    </div>
);

export const CheckRow: React.FC<{
    checked: boolean;
    title: string;
    description?: string;
    disabled?: boolean;
    onChange: (checked: boolean) => void;
}> = ({ checked, title, description, disabled = false, onChange }) => (
    <label className="ui-check-row">
        <input
            type="checkbox"
            checked={checked}
            disabled={disabled}
            onChange={(ev) => onChange(ev.currentTarget.checked)}
        />
        <span>
            <b>{title}</b>
            {description && <small>{description}</small>}
        </span>
    </label>
);
