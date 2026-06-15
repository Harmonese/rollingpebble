import { convertTimeToTag } from "../../../domain/lyrics/lyricsDocument.js";
import { useEffect, useRef, useState } from "react";
import { AudioActionType, audioStatePubSub, currentTimePubSub } from "../../../shared/audioPlaybackEvents.js";
import { useAudio } from "../../../hooks/useAudio.js";

interface IPlaybackCursorProps {
    fixed: Fixed;
}

export const PlaybackCursor: React.FC<IPlaybackCursorProps> = ({ fixed }) => {
    const self = useRef(Symbol(PlaybackCursor.name));
    const audio = useAudio();

    const [time, setTime] = useState(audio.currentTime);
    const [paused, setPaused] = useState(audio.paused);
    const [rate, setRate] = useState(audio.playbackRate);

    useEffect(() => {
        return audioStatePubSub.sub(self.current, (data) => {
            switch (data.type) {
                case AudioActionType.pause: {
                    setPaused(data.payload);
                    break;
                }
                case AudioActionType.rateChange: {
                    setRate(data.payload);
                    break;
                }
            }
        });
    }, []);

    useEffect(() => {
        //
        // Nyquist–Shannon sampling theorem
        //
        // If a function x(t) contains no frequencies higher than B hertz,
        // it is completely determined by giving its ordinates at a series
        // of points spaced 1/(2B) seconds apart.
        //

        const B = [1, 10, 100, 1000][fixed] * rate;

        if (paused || 2 * B > 60 /** 60fps */) {
            return currentTimePubSub.sub(self.current, (date) => {
                setTime(date);
            });
        } else {
            const id = setInterval(
                () => {
                    setTime(audio.currentTime);
                },
                1000 / (2 * B),
            );

            return (): void => {
                clearInterval(id);
            };
        }
    }, [fixed, paused, rate]);

    return <time className="playback-cursor">{convertTimeToTag(time, fixed)}</time>;
};
