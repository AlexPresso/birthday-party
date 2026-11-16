"use client";
import { useEffect, useRef, useState } from "react";
import { Pause, Play } from "lucide-react";
import { useI18n } from "@/lib/i18n-context";

// One voice note plays at a time, across the whole page.
let playing: HTMLAudioElement | null = null;

export function formatVoiceTime(milliseconds: number) {
  const seconds = Math.max(0, Math.round(milliseconds / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

/**
 * A voice note as a bubble: play, a waveform that fills while it plays and
 * doubles as the seek bar, and the time. The audio loads on the first play.
 */
export function VoiceNote({
  src,
  durationMs,
  peaks,
}: {
  src: string;
  durationMs: number;
  peaks: readonly number[];
}) {
  const { t } = useI18n();
  const audio = useRef<HTMLAudioElement>(null);
  const [isPlaying, setPlaying] = useState(false);
  const [position, setPosition] = useState(0);
  const [failed, setFailed] = useState(false);
  const duration = durationMs / 1000;

  useEffect(() => {
    const element = audio.current;
    return () => {
      if (playing === element) playing = null;
    };
  }, []);

  async function toggle() {
    const element = audio.current;
    if (!element) return;
    if (!element.paused) {
      element.pause();
      return;
    }
    if (playing && playing !== element) playing.pause();
    playing = element;
    setFailed(false);
    try {
      await element.play();
    } catch (error) {
      // A pause before playback started is not a failure.
      if (!(error instanceof DOMException && error.name === "AbortError"))
        setFailed(true);
    }
  }

  function seek(seconds: number) {
    const element = audio.current;
    if (!element) return;
    element.currentTime = seconds;
    setPosition(seconds);
  }

  const progress = duration > 0 ? Math.min(position / duration, 1) : 0;
  const shown = isPlaying || position > 0 ? position * 1000 : durationMs;
  return (
    <div
      className="voice-note"
      role="group"
      aria-label={t("guestbookDesign.voiceNote", {
        duration: formatVoiceTime(durationMs),
      })}
    >
      <button
        type="button"
        className="voice-note-play"
        onClick={() => void toggle()}
        aria-label={t(
          isPlaying ? "guestbookDesign.pause" : "guestbookDesign.play",
        )}
      >
        {isPlaying ? (
          <Pause size={18} fill="currentColor" aria-hidden="true" />
        ) : (
          <Play size={18} fill="currentColor" aria-hidden="true" />
        )}
      </button>
      <div className="voice-note-wave">
        <span className="voice-note-bars" aria-hidden="true">
          {peaks.map((level, index) => (
            <span
              key={index}
              className={
                (index + 0.5) / peaks.length <= progress ? "played" : undefined
              }
              style={{ height: `${Math.max(12, (level / 255) * 100)}%` }}
            />
          ))}
        </span>
        <input
          type="range"
          min={0}
          max={duration}
          step={0.1}
          value={position}
          onChange={(event) => seek(Number(event.target.value))}
          aria-label={t("guestbookDesign.voiceNote", {
            duration: formatVoiceTime(durationMs),
          })}
          aria-valuetext={`${formatVoiceTime(position * 1000)} / ${formatVoiceTime(durationMs)}`}
        />
      </div>
      <span className="voice-note-time">{formatVoiceTime(shown)}</span>
      <audio
        ref={audio}
        src={src}
        preload="none"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => {
          setPlaying(false);
          setPosition(0);
        }}
        onTimeUpdate={(event) => setPosition(event.currentTarget.currentTime)}
        onError={() => {
          setPlaying(false);
          setFailed(true);
        }}
      />
      {failed && (
        <p className="voice-note-error" role="alert">
          {t("guestbookDesign.playbackFailed")}
        </p>
      )}
    </div>
  );
}
