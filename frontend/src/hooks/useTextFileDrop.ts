import { useEffect } from "react";

function isTextFile(file: File): boolean {
    return file.type.startsWith("text/") || /(?:\.lrc|\.txt)$/i.test(file.name);
}

function isFileDrag(ev: DragEvent): boolean {
    return Array.from(ev.dataTransfer?.types || []).includes("Files");
}

export function useTextFileDrop(onText: (text: string) => void): void {
    useEffect(() => {
        let dragCounter = 0;
        const root = document.documentElement;

        const onDragOver = (ev: DragEvent) => {
            if (!isFileDrag(ev)) return;
            ev.preventDefault();
        };
        const onDragEnter = (ev: DragEvent) => {
            if (!isFileDrag(ev)) return;
            ev.preventDefault();
            dragCounter++;
            document.body.classList.add("studio-drag-over");
        };
        const onDragLeave = (ev: DragEvent) => {
            if (!isFileDrag(ev)) return;
            ev.preventDefault();
            dragCounter--;
            if (dragCounter <= 0) {
                dragCounter = 0;
                document.body.classList.remove("studio-drag-over");
            }
        };
        const onDrop = (ev: DragEvent) => {
            if (!isFileDrag(ev)) return;
            ev.preventDefault();
            dragCounter = 0;
            document.body.classList.remove("studio-drag-over");
            const file = ev.dataTransfer?.files[0];
            if (!file || !isTextFile(file)) return;
            const fileReader = new FileReader();
            fileReader.addEventListener("load", () => onText(fileReader.result as string), { once: true });
            fileReader.readAsText(file, "utf-8");
        };

        root.addEventListener("dragover", onDragOver);
        root.addEventListener("dragenter", onDragEnter);
        root.addEventListener("dragleave", onDragLeave);
        root.addEventListener("drop", onDrop);
        return () => {
            root.removeEventListener("dragover", onDragOver);
            root.removeEventListener("dragenter", onDragEnter);
            root.removeEventListener("dragleave", onDragLeave);
            root.removeEventListener("drop", onDrop);
            document.body.classList.remove("studio-drag-over");
        };
    }, [onText]);
}
