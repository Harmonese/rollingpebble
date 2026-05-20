import type React from "react";
import { useEffect, useState } from "react";

const DEFAULT_EXIT_MS = 220;

export const ModalShell: React.FC<{
    open: boolean;
    onClose: () => void;
    ariaLabel: string;
    closeLabel?: string;
    modalClassName?: string;
    exitMs?: number;
    children: React.ReactNode;
}> = ({ open, onClose, ariaLabel, closeLabel, modalClassName = "", exitMs = DEFAULT_EXIT_MS, children }) => {
    const [rendered, setRendered] = useState(open);

    useEffect(() => {
        if (open) {
            setRendered(true);
            return;
        }
        const timer = window.setTimeout(() => setRendered(false), exitMs);
        return () => window.clearTimeout(timer);
    }, [open, exitMs]);

    useEffect(() => {
        if (!open) return;
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key === "Escape") onClose();
        };
        window.addEventListener("keydown", onKeyDown);
        return () => window.removeEventListener("keydown", onKeyDown);
    }, [open, onClose]);

    if (!rendered) return null;

    return (
        <div
            className="about-overlay"
            data-state={open ? "open" : "closed"}
            role="dialog"
            aria-modal="true"
            aria-label={ariaLabel}
        >
            <button className="about-backdrop" type="button" onClick={onClose} aria-label={closeLabel || ariaLabel} />
            <section className={["about-modal", modalClassName].filter(Boolean).join(" ")}>
                {children}
            </section>
        </div>
    );
};
