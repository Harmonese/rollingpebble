import type React from "react";
import type { MessageType } from "../shared/messageTypes.js";

export const Message: React.FC<{
    message: string;
    type: MessageType;
    fading: boolean;
    messageKey?: number;
    className?: string;
}> = ({ message, type, fading, messageKey, className = "" }) => {
    if (!message) return null;
    const classes = ["ui-message", type, fading ? "fading" : "", className].filter(Boolean).join(" ");
    return <p key={messageKey} className={classes}>{message}</p>;
};

export const MessageText: React.FC<React.HTMLAttributes<HTMLParagraphElement> & {
    type?: MessageType | "subtle";
}> = ({ type = "subtle", className = "", ...props }) => (
    <p className={["ui-message", type, className].filter(Boolean).join(" ")} {...props} />
);
