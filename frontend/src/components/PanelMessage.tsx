import type React from "react";
import type { MessageType } from "../hooks/useMessage.js";

export const PanelMessage: React.FC<{
    message: string;
    type: MessageType;
    fading: boolean;
    messageKey?: number;
    className?: string;
}> = ({ message, type, fading, messageKey, className = "" }) => {
    if (!message) return null;
    const classes = ["roller-message", type, fading ? "fading" : "", className].filter(Boolean).join(" ");
    return <p key={messageKey} className={classes}>{message}</p>;
};
