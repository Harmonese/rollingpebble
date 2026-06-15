import type React from "react";

export const DialogActionRow: React.FC<{
    children: React.ReactNode;
}> = ({ children }) => (
    <div className="ui-dialog-action-row">
        {children}
    </div>
);
