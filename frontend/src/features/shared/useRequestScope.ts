import { useEffect, useRef } from "react";

/** Invalidates asynchronous work immediately on input change, supersession or unmount. */
export function useRequestScope(identity: string) {
    const state = useRef({ identity, version: 0, request: 0, mounted: true });
    if (state.current.identity !== identity) {
        state.current.identity = identity;
        state.current.version++;
    }
    useEffect(() => {
        state.current.mounted = true;
        return () => {
            state.current.mounted = false;
            state.current.request++;
        };
    }, []);
    const version = state.current.version;
    const snapshot = () => {
        return () => state.current.mounted && state.current.identity === identity && state.current.version === version;
    };
    const begin = () => {
        if (!state.current.mounted || state.current.identity !== identity || state.current.version !== version) {
            return () => false;
        }
        const valid = snapshot();
        const request = ++state.current.request;
        return () => valid() && state.current.request === request;
    };
    return { begin, snapshot };
}
