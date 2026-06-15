import { useLayoutEffect, useRef, useState, type CSSProperties } from "react";

type TabItem<T extends string> = {
    value: T;
    label: string;
};

export function Tabs<T extends string>({
    ariaLabel,
    items,
    value,
    onChange,
}: {
    ariaLabel: string;
    items: TabItem<T>[];
    value: T;
    onChange: (value: T) => void;
}) {
    const rootRef = useRef<HTMLDivElement | null>(null);
    const activeRef = useRef<HTMLButtonElement | null>(null);
    const [slider, setSlider] = useState({ x: 3, width: 0 });

    useLayoutEffect(() => {
        const root = rootRef.current;
        const active = activeRef.current;
        if (!root || !active) return;

        const update = () => {
            setSlider({
                x: active.offsetLeft,
                width: active.offsetWidth,
            });
        };

        const scrollActiveIntoView = () => {
            const activeLeft = active.offsetLeft;
            const activeRight = activeLeft + active.offsetWidth;
            const visibleLeft = root.scrollLeft;
            const visibleRight = visibleLeft + root.clientWidth;
            if (activeLeft < visibleLeft) {
                root.scrollTo({ left: activeLeft - 3, behavior: "smooth" });
            } else if (activeRight > visibleRight) {
                root.scrollTo({ left: activeRight - root.clientWidth + 3, behavior: "smooth" });
            }
        };

        update();
        scrollActiveIntoView();

        const resizeObserver = new ResizeObserver(update);
        resizeObserver.observe(root);
        resizeObserver.observe(active);
        return () => resizeObserver.disconnect();
    }, [items, value]);

    const style = {
        "--tabs-slider-x": `${slider.x}px`,
        "--tabs-slider-width": `${slider.width}px`,
    } as CSSProperties;

    return (
        <div ref={rootRef} className="ui-tabs scrollable animated" role="tablist" aria-label={ariaLabel} style={style}>
            <span className="ui-tabs-slider" />
            {items.map((item) => (
                <button
                    key={item.value}
                    ref={item.value === value ? activeRef : undefined}
                    className={item.value === value ? "active" : ""}
                    type="button"
                    role="tab"
                    aria-selected={item.value === value}
                    onClick={() => onChange(item.value)}
                >
                    {item.label}
                </button>
            ))}
        </div>
    );
}
