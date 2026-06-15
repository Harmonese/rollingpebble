import { createContext, type RefObject } from "react";

export const audioElementContext = createContext<RefObject<HTMLAudioElement> | null>(null);
