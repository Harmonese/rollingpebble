import type React from "react";
import { MessageText } from "./Message.js";

export const TaskStatus: React.FC<{
    title: string;
    active?: boolean;
    fraction?: number;
    summary?: React.ReactNode;
    meta?: React.ReactNode;
    error?: string;
    children?: React.ReactNode;
}> = ({ title, active = true, fraction, summary, meta, error, children }) => {
    const value = fraction === undefined ? undefined : Math.max(0, Math.min(1, fraction));
    return (
        <section className="ui-task-status studio-progress-card" aria-busy={active}>
            <div className="studio-progress-head" role="status">
                <b>{title}</b>
                {summary}
            </div>
            {active && (
                <div
                    className={`studio-progress-bar${value === undefined ? " indeterminate" : ""}`}
                    role="progressbar"
                    aria-label={title}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={value === undefined ? undefined : Math.round(value * 100)}
                >
                    <span style={value === undefined ? undefined : { width: `${value * 100}%` }} />
                </div>
            )}
            {meta && <div className="studio-progress-meta">{meta}</div>}
            {error && <MessageText type="error" role="alert">{error}</MessageText>}
            {children && <div className="ui-task-actions">{children}</div>}
        </section>
    );
};
