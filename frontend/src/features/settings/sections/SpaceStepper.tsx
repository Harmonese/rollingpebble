import { useId } from "react";

export const SpaceStepper: React.FC<{
    label: string;
    value: number;
    onChange: (value: number) => void;
}> = ({ label, value, onChange }) => {
    const labelId = useId();
    const setSafeValue = (next: number) => onChange(Math.max(0, Number.isFinite(next) ? Math.round(next) : 0));
    return (
        <div className="space-stepper-field">
            <span id={labelId}>{label}</span>
            <div className="space-stepper" role="group" aria-labelledby={labelId}>
                <button
                    type="button"
                    className="space-stepper-btn"
                    aria-label={`${label} -`}
                    disabled={value <= 0}
                    onClick={() => setSafeValue(value - 1)}
                >
                    -
                </button>
                <input
                    inputMode="numeric"
                    aria-labelledby={labelId}
                    value={value}
                    onChange={(ev) => setSafeValue(Number(ev.currentTarget.value))}
                />
                <button
                    type="button"
                    className="space-stepper-btn"
                    aria-label={`${label} +`}
                    onClick={() => setSafeValue(value + 1)}
                >
                    +
                </button>
            </div>
        </div>
    );
};
