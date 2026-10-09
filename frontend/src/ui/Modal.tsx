import type React from "react";
import { useEffect, useRef, useState } from "react";

const DEFAULT_EXIT_MS = 220;
const modalStack: HTMLElement[] = [];
const focusableSelector =
    "button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex=\"0\"]";

export const Modal: React.FC<{
    open: boolean;
    onClose: () => void;
    ariaLabel: string;
    closeLabel?: string;
    modalClassName?: string;
    exitMs?: number;
    children: React.ReactNode;
}> = ({ open, onClose, ariaLabel, closeLabel, modalClassName = "", exitMs = DEFAULT_EXIT_MS, children }) => {
    const overlay = useRef<HTMLDivElement>(null);
    const closeRef = useRef(onClose);
    closeRef.current = onClose;
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
        const root = overlay.current;
        if (!open || !root) return;
        const previous = document.activeElement as HTMLElement | null;
        modalStack.push(root);
        root.style.zIndex = String(1000 + modalStack.length);
        const panel = root.querySelector<HTMLElement>(".about-modal")!;
        const focusFirst = () => (panel.querySelector<HTMLElement>(focusableSelector) || root).focus();
        focusFirst();
        const onFocus = (event: FocusEvent) => {
            if (modalStack[modalStack.length - 1] === root && !root.contains(event.target as Node)) focusFirst();
        };
        const onKeyDown = (event: KeyboardEvent) => {
            if (modalStack[modalStack.length - 1] !== root) return;
            event.stopPropagation();
            if (event.key === "Escape") {
                event.preventDefault();
                closeRef.current();
            }
            if (event.key === "Tab") {
                const items = Array.from(panel.querySelectorAll<HTMLElement>(focusableSelector)).filter((item) =>
                    item.offsetParent !== null
                );
                const index = items.indexOf(document.activeElement as HTMLElement);
                event.preventDefault();
                (items[(index + (event.shiftKey ? -1 : 1) + items.length) % items.length] || root).focus();
            }
        };
        // Bubble on the overlay: controls receive their keys, background document listeners do not.
        root.addEventListener("keydown", onKeyDown);
        document.addEventListener("focusin", onFocus);
        return () => {
            modalStack.splice(modalStack.indexOf(root), 1);
            root.removeEventListener("keydown", onKeyDown);
            document.removeEventListener("focusin", onFocus);
            if (previous?.isConnected) previous.focus();
        };
    }, [open, rendered]);

    if (!rendered) return null;

    return (
        <div
            ref={overlay}
            tabIndex={-1}
            className="about-overlay"
            data-state={open ? "open" : "closed"}
            role="dialog"
            aria-modal="true"
            aria-label={ariaLabel}
        >
            <button
                className="about-backdrop"
                type="button"
                tabIndex={-1}
                onClick={onClose}
                aria-label={closeLabel || ariaLabel}
            />
            <section className={["about-modal", modalClassName].filter(Boolean).join(" ")}>
                {children}
            </section>
        </div>
    );
};
