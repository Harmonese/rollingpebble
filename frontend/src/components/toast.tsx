import { useCallback, useEffect, useRef, useState } from "react";
import { createPubSub } from "../utils/pubsub.js";
import { CheckSVG, InfoSVG, ProblemSVG } from "./svg.js";
import type { MessageType } from "../hooks/useMessage.js";

interface IMessage {
    type: MessageType;
    text: string;
}

export const toastPubSub = createPubSub<IMessage>();

const box = { id: 0 };
const MAX_TOAST = 5;

export const Toast: React.FC = () => {
    const self = useRef(Symbol(Toast.name));

    interface IToast extends IMessage {
        id: number;
    }

    const [toastQueue, setToastQueue] = useState<IToast[]>([]);
    const timersRef = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map());

    useEffect(() => {
        return toastPubSub.sub(self.current, (data) => {
            const id = box.id++;
            const toast: IToast = { id, ...data };
            setToastQueue((queue) => {
                const next = [toast, ...queue];
                if (next.length > MAX_TOAST) next.pop();
                return next;
            });
            const timer = setTimeout(() => {
                setToastQueue((queue) => queue.filter((item) => item.id !== id));
                timersRef.current.delete(id);
            }, 5000);
            timersRef.current.set(id, timer);
        });
    }, []);

    useEffect(() => {
        return () => {
            timersRef.current.forEach((timer) => clearTimeout(timer));
            timersRef.current.clear();
        };
    }, []);

    const onAnimationEnd = useCallback((ev: React.AnimationEvent<HTMLElement>) => {
        if (ev.animationName === "slide-out-right") {
            setToastQueue((queue) => {
                const removed = queue[queue.length - 1];
                if (removed) {
                    const timer = timersRef.current.get(removed.id);
                    if (timer) { clearTimeout(timer); timersRef.current.delete(removed.id); }
                }
                return queue.slice(0, -1);
            });
        }
    }, []);

    const ToastIter = useCallback((toast: IToast) => {
        const badge = {
            info: <InfoSVG />,
            success: <CheckSVG />,
            warning: <ProblemSVG />,
            error: <ProblemSVG />,
        }[toast.type];

        return (
            <section className="toast" key={toast.id}>
                <section className={`toast-badge toast-${toast.type}`}>{badge}</section>
                <section className="toast-text">{toast.text}</section>
            </section>
        );
    }, []);

    return (
        <div className="toast-queue" aria-live="polite" role="status" onAnimationEnd={onAnimationEnd}>
            {toastQueue.map(ToastIter)}
        </div>
    );
};
