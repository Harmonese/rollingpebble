import type React from "react";

export const SettingsActionRow: React.FC<{
    title: string;
    description?: string;
    className?: string;
    children: React.ReactNode;
}> = ({ title, description, className = "", children }) => (
    <div className={["settings-action-row", className].filter(Boolean).join(" ")}>
        <div className="settings-action-main">
            <b>{title}</b>
            {description && <small>{description}</small>}
        </div>
        <div className="settings-action-buttons">
            {children}
        </div>
    </div>
);

export const SettingsCheckRow: React.FC<{
    checked: boolean;
    title: string;
    description?: string;
    disabled?: boolean;
    onChange: (checked: boolean) => void;
}> = ({ checked, title, description, disabled = false, onChange }) => (
    <label className="settings-check-row">
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
