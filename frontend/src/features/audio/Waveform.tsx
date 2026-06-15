import { useWavesurfer } from "@wavesurfer/react";
import { useEffect, useRef } from "react";
import { useAudio } from "../../hooks/useAudio.js";
import "./waveform.css";

interface IWaveformProps {
    // time in seconds
    value: number;
    /**
     * @param time seconds
     */
    onSeek: (time: number) => void;
    className?: string;
}

export const Waveform: React.FC<IWaveformProps> = ({ value, onSeek, className }) => {
    const audio = useAudio();
    const containerRef = useRef<HTMLDivElement>(null);

    const style = getComputedStyle(document.documentElement);
    const themeColor = style.getPropertyValue("--theme-color");
    const mutedColor = style.getPropertyValue("--studio-muted").trim() || "#aab2b9";
    const { wavesurfer } = useWavesurfer({
        container: containerRef,
        waveColor: mutedColor,
        progressColor: themeColor,
        cursorColor: themeColor,
        normalize: true,
        height: "auto",
        interact: true,
        dragToSeek: true,
    });

    // attach drag listener
    useEffect(() => {
        return wavesurfer?.on("interaction", (currentTime) => {
            onSeek(currentTime);
        });
    }, [wavesurfer, onSeek]);

    // Update the seekTo position when value prop changes
    useEffect(() => {
        wavesurfer?.setTime(value);
    }, [wavesurfer, value]);

    useEffect(() => {
        if (!wavesurfer || !audio.src) return;
        wavesurfer.load(audio.src).then(() => {
            wavesurfer.setTime(value);
        }).catch(() => { /* load failure is non-fatal */ });
    }, [wavesurfer, audio.src]);

    return <div className={`waveform ${className || ""}`} ref={containerRef}></div>;
};
