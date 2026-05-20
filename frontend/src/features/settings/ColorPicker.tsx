import { useCallback, useEffect, useRef, useState } from "react";

const PALETTE: string[][] = [
    ["#ff6b6b", "#ee5a24", "#f0932b", "#fdcb6e", "#e056a0", "#be2edd", "#7c3aed", "#3b82f6", "#0984e3", "#00a8ff", "#0097e6", "#18dcff"],
    ["#fc5c65", "#eb3b5a", "#fa8231", "#f7b731", "#f368e0", "#a55eea", "#8854d0", "#3867d6", "#2d98da", "#45aaf2", "#4bcffa", "#7efff4"],
    ["#ff4757", "#ff6348", "#ff7f50", "#ffa502", "#e84393", "#a29bfe", "#6c5ce7", "#4b7bec", "#26de81", "#2bcbba", "#0abde3", "#48dbfb"],
    ["#e74c3c", "#c0392b", "#e67e22", "#d35400", "#8e44ad", "#9b59b6", "#2980b9", "#3498db", "#1abc9c", "#16a085", "#27ae60", "#2ecc71"],
    ["#b71540", "#c44569", "#e66767", "#f19066", "#574b90", "#786fa6", "#3dc1d3", "#63cdda", "#019031", "#10ac84", "#1289a7", "#54a0ff"],
    ["#ffc048", "#ff9f43", "#ee5a6f", "#c44569", "#f78fb3", "#cf6a87", "#0fb9b1", "#01a3a4", "#009432", "#006266", "#0652DD", "#1e3799"],
    ["#eccc68", "#ff7f50", "#ff6348", "#eb4d4b", "#ff7979", "#badc58", "#7bed9f", "#70a1ff", "#5352ed", "#2ed573", "#1e90ff", "#3742fa"],
    ["#f9ca24", "#f0932b", "#e056a0", "#be2edd", "#686de0", "#4834d4", "#22a6b3", "#7ed6df", "#6ab04c", "#badc58", "#c7ecee", "#dff9fb"],
    ["#ffffff", "#f5f6fa", "#dcdde1", "#a4b0be", "#747d8c", "#576574", "#2f3640", "#1e272e", "#0abde3", "#10ac84", "#f368e0", "#ff9ff3"],
    ["#f1f2f6", "#dfe4ea", "#ced6e0", "#a4b0be", "#8395a7", "#636e72", "#2d3436", "#111111", "#2bcbba", "#55efc4", "#fdcb6e", "#ffeaa7"],
];

export const ColorPicker: React.FC<{
    value: string;
    onChange: (color: string) => void;
    title: string;
}> = ({ value, onChange, title }) => {
    const [open, setOpen] = useState(false);
    const [rendered, setRendered] = useState(false);
    const ref = useRef<HTMLDivElement>(null);
    const swatchRef = useRef<HTMLButtonElement>(null);
    const activeValue = value.toLowerCase();

    const close = useCallback((e: MouseEvent) => {
        if (ref.current && !ref.current.contains(e.target as Node)) {
            setOpen(false);
        }
    }, []);

    useEffect(() => {
        if (open) {
            setRendered(true);
            document.addEventListener("mousedown", close);
            return () => document.removeEventListener("mousedown", close);
        }
        const timer = window.setTimeout(() => setRendered(false), 130);
        return () => window.clearTimeout(timer);
    }, [open, close]);

    return (
        <div className="cp-root" ref={ref}>
            <button
                ref={swatchRef}
                type="button"
                className="cp-swatch"
                onClick={() => setOpen(!open)}
                title={title}
                aria-label={title}
            />
            {rendered && (
                <div className="cp-popover" data-state={open ? "open" : "closed"}>
                    {PALETTE.map((row, ri) => (
                        <div key={ri} className="cp-row">
                            {row.map((color) => (
                                <button
                                    key={color}
                                    type="button"
                                    className={`cp-cell${activeValue === color.toLowerCase() ? " active" : ""}`}
                                    style={{ backgroundColor: color }}
                                    onMouseDown={(ev) => ev.preventDefault()}
                                    onClick={(ev) => {
                                        ev.stopPropagation();
                                        onChange(color);
                                        setOpen(false);
                                        window.requestAnimationFrame(() => swatchRef.current?.focus());
                                    }}
                                />
                            ))}
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
};
