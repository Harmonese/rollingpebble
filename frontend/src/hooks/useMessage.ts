import { useState, useRef, useEffect, useCallback } from "react";

export type MessageType = "info" | "success" | "warning" | "error";

/**
 * Message state with optional auto-dismiss and typed styling.
 * - setMessage(text) — stays until replaced or cleared (defaults to "info")
 * - setMessage(text, type) — use a specific message type
 * - setMessage(text, ms) — auto-dismiss after `ms` milliseconds
 * - setMessage(text, type, ms) — typed + auto-dismiss
 * - clearMessage() — clears immediately
 * - fading — flag for CSS fade-out class
 */
export function useMessage(initial = "") {
    const [message, setMessageState] = useState(initial);
    const [type, setType] = useState<MessageType>("info");
    const [fading, setFading] = useState(false);
    const timerRef = useRef<ReturnType<typeof setTimeout>>();

    const clearMessage = useCallback(() => {
        clearTimeout(timerRef.current);
        setMessageState("");
        setFading(false);
    }, []);

    const setMessage = useCallback((
        text: string,
        arg2?: MessageType | number,
        arg3?: number,
    ) => {
        clearTimeout(timerRef.current);
        setFading(false);
        setMessageState(text);

        let msgType: MessageType = "info";
        let duration = 0;

        if (typeof arg2 === "number") {
            duration = arg2;
            if (typeof arg3 === "number") {
                msgType = (arg3 as MessageType) || "info";
            }
        } else if (typeof arg2 === "string") {
            msgType = arg2;
            if (typeof arg3 === "number") {
                duration = arg3;
            }
        }

        setType(msgType);

        if (duration > 0 && text) {
            timerRef.current = setTimeout(() => {
                setFading(true);
                timerRef.current = setTimeout(() => {
                    setMessageState("");
                    setFading(false);
                }, 350);
            }, duration);
        }
    }, []);

    useEffect(() => {
        return () => clearTimeout(timerRef.current);
    }, []);

    return [message, setMessage, clearMessage, fading, type] as const;
}
