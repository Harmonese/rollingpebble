export function lyricMarkKey(
    event: Pick<KeyboardEvent, "code" | "ctrlKey" | "metaKey" | "altKey" | "shiftKey">,
): { slot: number; action: "mark" | "insert" | "unmark" } | null {
    const digit = /^(?:Digit|Numpad)([0-9])$/.exec(event.code);
    if (!digit || ((event.ctrlKey || event.metaKey) === event.altKey) || (event.altKey && event.shiftKey)) return null;
    return { slot: (Number(digit[1]) + 9) % 10, action: event.altKey ? "mark" : event.shiftKey ? "unmark" : "insert" };
}

export function synchronizerCommand(
    event: Pick<KeyboardEvent, "code" | "ctrlKey" | "metaKey" | "altKey" | "shiftKey">,
): "selectPlaying" | "deleteLine" | "undoMarkedLine" | null {
    if (event.altKey || event.shiftKey) return null;
    if (event.ctrlKey || event.metaKey) {
        if (event.code === "Delete" || event.code === "Backspace") return "deleteLine";
        if (event.code === "KeyZ") return "undoMarkedLine";
    } else if (event.code === "Digit1" || event.code === "Numpad1") return "selectPlaying";
    return null;
}

export function blocksSynchronizerKeys(target: EventTarget | null): boolean {
    return Boolean(
        (target as HTMLElement | null)?.closest?.(
            "input, textarea, select, [contenteditable]:not([contenteditable=false]), [role=dialog]",
        ),
    );
}
