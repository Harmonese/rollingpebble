import type React from "react";

export const Field: React.FC<{
    label: string;
    note?: string;
    children: React.ReactNode;
}> = ({ label, note, children }) => (
    <label className="ui-field">
        <span>{label}</span>
        {children}
        {note && <small>{note}</small>}
    </label>
);
