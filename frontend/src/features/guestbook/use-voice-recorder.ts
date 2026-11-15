"use client";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

/** Five minutes, the server's limit; recording stops there by itself. */
export const maxVoiceMs = 5 * 60 * 1000;
const peakCount = 48;
const liveBars = 28;
const sampleEvery = 100;

export type Recording = {
  blob: Blob;
  url: string;
  durationMs: number;
  peaks: number[];
};

export type RecorderState =
  | { status: "idle" }
  | { status: "recording"; elapsedMs: number; levels: number[] }
  | { status: "recorded"; recording: Recording };

export type RecorderError = "denied" | "unavailable";

// WebM and Ogg Opus where the browser has them, AAC in MP4 on Safari; the
// server re-encodes every one of them.
const containers = [
  "audio/webm;codecs=opus",
  "audio/ogg;codecs=opus",
  "audio/mp4",
  "audio/webm",
];

function canRecordVoice() {
  return (
    window.isSecureContext &&
    typeof MediaRecorder !== "undefined" &&
    typeof navigator.mediaDevices?.getUserMedia === "function"
  );
}

const noChanges = () => () => {};

/** Whether this browser can record; the server render shows no microphone. */
export function useCanRecordVoice() {
  return useSyncExternalStore(noChanges, canRecordVoice, () => false);
}

// Groups the levels sampled while recording into the waveform's bars.
function waveform(levels: number[]) {
  if (levels.length === 0) return Array<number>(peakCount).fill(0);
  const loudest = Math.max(...levels, 0.01);
  return Array.from({ length: peakCount }, (_, index) => {
    const start = Math.floor((index * levels.length) / peakCount);
    const end = Math.max(
      start + 1,
      Math.floor(((index + 1) * levels.length) / peakCount),
    );
    const slice = levels.slice(start, end);
    return Math.round((Math.max(...slice) / loudest) * 255);
  });
}

/**
 * Records one voice note from the microphone. The microphone is released as
 * soon as recording stops, is cancelled or the component leaves.
 */
export function useVoiceRecorder() {
  const [state, setState] = useState<RecorderState>({ status: "idle" });
  const [error, setError] = useState<RecorderError | null>(null);
  const session = useRef<{
    recorder: MediaRecorder;
    stream: MediaStream;
    context: AudioContext;
    timer: number;
    cancelled: boolean;
  } | null>(null);
  const recordedUrl = useRef<string | null>(null);

  const release = useCallback(() => {
    const current = session.current;
    if (!current) return;
    session.current = null;
    window.clearInterval(current.timer);
    current.stream.getTracks().forEach((track) => track.stop());
    void current.context.close().catch(() => {});
  }, []);

  const clear = useCallback(() => {
    if (recordedUrl.current) URL.revokeObjectURL(recordedUrl.current);
    recordedUrl.current = null;
    setState({ status: "idle" });
  }, []);

  const start = useCallback(async () => {
    if (session.current) return;
    setError(null);
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (cause) {
      setError(
        cause instanceof DOMException &&
          (cause.name === "NotAllowedError" || cause.name === "SecurityError")
          ? "denied"
          : "unavailable",
      );
      return;
    }
    const mimeType = containers.find((type) =>
      MediaRecorder.isTypeSupported(type),
    );
    const recorder = new MediaRecorder(stream, {
      ...(mimeType ? { mimeType } : {}),
      audioBitsPerSecond: 64_000,
    });
    // The live bars and the preview's waveform come from the input level.
    const context = new AudioContext();
    const analyser = context.createAnalyser();
    analyser.fftSize = 1024;
    context.createMediaStreamSource(stream).connect(analyser);
    const samples = new Float32Array(analyser.fftSize);
    const levels: number[] = [];
    const chunks: Blob[] = [];
    const started = performance.now();
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) chunks.push(event.data);
    };
    recorder.onstop = () => {
      const cancelled = session.current?.cancelled ?? true;
      const durationMs = Math.min(performance.now() - started, maxVoiceMs);
      release();
      if (cancelled || chunks.length === 0) {
        setState({ status: "idle" });
        return;
      }
      const blob = new Blob(chunks, {
        type: recorder.mimeType || mimeType || "audio/webm",
      });
      const url = URL.createObjectURL(blob);
      recordedUrl.current = url;
      setState({
        status: "recorded",
        recording: { blob, url, durationMs, peaks: waveform(levels) },
      });
    };
    const timer = window.setInterval(() => {
      analyser.getFloatTimeDomainData(samples);
      let sum = 0;
      for (const sample of samples) sum += sample * sample;
      levels.push(Math.sqrt(sum / samples.length));
      const elapsedMs = performance.now() - started;
      if (elapsedMs >= maxVoiceMs && recorder.state === "recording") {
        recorder.stop();
        return;
      }
      setState({
        status: "recording",
        elapsedMs,
        levels: levels.slice(-liveBars),
      });
    }, sampleEvery);
    session.current = { recorder, stream, context, timer, cancelled: false };
    recorder.start(1000);
    setState({ status: "recording", elapsedMs: 0, levels: [] });
  }, [release]);

  const stop = useCallback(() => {
    const current = session.current;
    if (current?.recorder.state === "recording") current.recorder.stop();
  }, []);

  const cancel = useCallback(() => {
    const current = session.current;
    if (!current) return;
    current.cancelled = true;
    if (current.recorder.state === "recording") current.recorder.stop();
    else release();
  }, [release]);

  useEffect(
    () => () => {
      if (session.current) {
        session.current.cancelled = true;
        if (session.current.recorder.state === "recording")
          session.current.recorder.stop();
        release();
      }
      if (recordedUrl.current) URL.revokeObjectURL(recordedUrl.current);
    },
    [release],
  );

  return { state, error, start, stop, cancel, clear };
}
