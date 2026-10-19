type Native = { invoke: (command: string, args?: Record<string, unknown>) => Promise<unknown> };
const native = () => (window as unknown as { __TAURI_INTERNALS__?: Native }).__TAURI_INTERNALS__;

export function registerDesktopExit(prepare: () => Promise<boolean>) {
    if (!native()) return () => {};
    let pending = false;
    const exit = async () => {
        if (pending) return;
        pending = true;
        let approved = false;
        try {
            approved = await prepare();
        } finally {
            try {
                await native()!.invoke("workspace_exit_reply", { approved });
            } finally {
                pending = false;
            }
        }
    };
    const listener = () => {
        void exit().catch(() => {});
    };
    window.addEventListener("rollingpebble:exit-requested", listener);
    void native()!.invoke("workspace_ready").catch(() => {});
    return () => window.removeEventListener("rollingpebble:exit-requested", listener);
}
