import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { appContext } from "../shared/appContext.js";
import { Button } from "./Button.js";
import { DialogActionRow } from "./DialogActionRow.js";
import { Modal } from "./Modal.js";

type Choice = "confirm" | "discard" | "cancel";
type Options = { message: string; confirmLabel?: string; discardLabel?: string; danger?: boolean };
type Ask = (options: Options) => Promise<Choice>;
const ConfirmContext = createContext<Ask | null>(null);

export function useConfirmDialog(): Ask {
    const ask = useContext(ConfirmContext);
    if (!ask) throw new Error("ConfirmProvider is missing");
    return ask;
}

export const ConfirmProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const { lang } = useContext(appContext);
    const [options, setOptions] = useState<Options | null>(null);
    const pending = useRef<((choice: Choice) => void) | null>(null);
    const ask = useCallback<Ask>((next) => {
        // A second click must not replace an unanswered destructive decision.
        if (pending.current) return Promise.resolve("cancel");
        setOptions(next);
        return new Promise((resolve) => {
            pending.current = resolve;
        });
    }, []);
    const finish = useCallback((choice: Choice) => {
        const resolve = pending.current;
        pending.current = null;
        setOptions(null);
        resolve?.(choice);
    }, []);
    useEffect(() => () => {
        pending.current?.("cancel");
    }, []);

    return (
        <ConfirmContext.Provider value={ask}>
            {children}
            <Modal
                open={Boolean(options)}
                onClose={() => finish("cancel")}
                ariaLabel={lang.ui.confirmAction}
                modalClassName="confirm-modal"
                exitMs={0}
            >
                <h2>{lang.ui.confirmAction}</h2>
                <p className="confirm-message">{options?.message}</p>
                <DialogActionRow>
                    <Button onClick={() => finish("cancel")}>{lang.ui.cancel}</Button>
                    {options?.discardLabel && <Button onClick={() => finish("discard")}>{options.discardLabel}</Button>}
                    <Button tone={options?.danger ? "danger" : "primary"} onClick={() => finish("confirm")}>
                        {options?.confirmLabel || lang.ui.confirmAction}
                    </Button>
                </DialogActionRow>
            </Modal>
        </ConfirmContext.Provider>
    );
};
