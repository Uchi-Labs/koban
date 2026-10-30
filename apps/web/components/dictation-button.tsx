"use client";

import { Mic, Square } from "lucide-react";
import * as React from "react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { isDictationSupported, loadDictationModel, transcribeRecording, type DictationProgress } from "@/lib/dictation";
import { cn } from "@/lib/utils";

const maxRecordingMs = 60_000;

/** What the button is doing, for the host to show as text; the button itself is icon-only. */
export type DictationStatus =
  | { kind: "idle" }
  | { kind: "recording"; modelPercent: number | null; seconds: number }
  | { kind: "transcribing"; modelPercent: number | null }
  | { kind: "error"; message: string };

type DictationState =
  | { kind: "idle" }
  | { kind: "recording"; startedAt: number }
  | { kind: "transcribing" }
  | { kind: "error"; message: string };

/**
 * Tap to record, tap again to stop; the transcript is handed to `onText`.
 * The speech model starts downloading as soon as recording starts, so most of
 * a first-time download overlaps with speaking. Status text goes to
 * `onStatusChange` so the host can place it outside the input row.
 */
export function DictationButton({ className, disabled, onStatusChange, onText }: {
  className?: string;
  disabled?: boolean;
  onStatusChange: (status: DictationStatus) => void;
  onText: (text: string) => void;
}) {
  const [supported, setSupported] = React.useState(false);
  const [state, setState] = React.useState<DictationState>({ kind: "idle" });
  const [progress, setProgress] = React.useState<DictationProgress | null>(null);
  const [elapsed, setElapsed] = React.useState(0);
  const recorderRef = React.useRef<MediaRecorder | null>(null);
  const chunksRef = React.useRef<Blob[]>([]);
  const stopTimerRef = React.useRef(0);

  React.useEffect(() => setSupported(isDictationSupported()), []);

  React.useEffect(() => {
    if (state.kind !== "recording") return;
    const timer = window.setInterval(() => setElapsed(Math.floor((Date.now() - state.startedAt) / 1000)), 250);
    return () => window.clearInterval(timer);
  }, [state]);

  React.useEffect(() => () => {
    window.clearTimeout(stopTimerRef.current);
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== "inactive") recorder.stop();
  }, []);

  const downloading = progress !== null && progress.totalBytes > 0 && progress.loadedBytes < progress.totalBytes;
  const modelPercent = downloading ? Math.round((progress.loadedBytes / progress.totalBytes) * 100) : null;

  React.useEffect(() => {
    onStatusChange(
      state.kind === "recording"
        ? { kind: "recording", modelPercent, seconds: elapsed }
        : state.kind === "transcribing"
          ? { kind: "transcribing", modelPercent }
          : state
    );
  }, [elapsed, modelPercent, onStatusChange, state]);

  async function start() {
    setState({ kind: "idle" });
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } });
    } catch {
      setState({ kind: "error", message: "Microphone access was blocked." });
      return;
    }
    void loadDictationModel(setProgress).catch(() => undefined);

    const recorder = new MediaRecorder(stream);
    chunksRef.current = [];
    recorder.addEventListener("dataavailable", (event) => {
      if (event.data.size > 0) chunksRef.current.push(event.data);
    });
    recorder.addEventListener("stop", () => {
      for (const track of stream.getTracks()) track.stop();
      void finish(new Blob(chunksRef.current, { type: recorder.mimeType }));
    });
    recorderRef.current = recorder;
    recorder.start();
    setElapsed(0);
    setState({ kind: "recording", startedAt: Date.now() });
    stopTimerRef.current = window.setTimeout(stop, maxRecordingMs);
  }

  function stop() {
    window.clearTimeout(stopTimerRef.current);
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== "inactive") recorder.stop();
  }

  async function finish(recording: Blob) {
    recorderRef.current = null;
    if (recording.size === 0) {
      setState({ kind: "idle" });
      return;
    }
    setState({ kind: "transcribing" });
    try {
      const text = await transcribeRecording(recording);
      if (text) onText(text);
      setState(text ? { kind: "idle" } : { kind: "error", message: "Didn't catch that. Try again a little closer to the mic." });
    } catch {
      setState({ kind: "error", message: "Dictation failed on this device. Typing still works." });
    }
  }

  if (!supported) {
    return (
      <Button
        aria-label="Dictation isn't available in this browser"
        className={className}
        disabled
        size="icon-sm"
        title="Dictation needs microphone recording, which this browser doesn't offer"
        type="button"
        variant="ghost"
      >
        <Mic className="size-4" />
      </Button>
    );
  }

  if (state.kind === "recording") {
    return (
      <Button
        aria-label="Stop dictation"
        className={cn("text-(--negative) hover:text-(--negative)", className)}
        onClick={stop}
        size="icon-sm"
        title="Stop and transcribe"
        type="button"
        variant="ghost"
      >
        <Square className="size-3.5 fill-current" />
      </Button>
    );
  }

  if (state.kind === "transcribing") {
    return (
      <Button aria-label="Transcribing" className={className} disabled size="icon-sm" type="button" variant="ghost">
        <Spinner decorative size="sm" variant="ring" />
      </Button>
    );
  }

  return (
    <Button
      aria-label="Dictate context"
      className={className}
      disabled={disabled}
      onClick={() => void start()}
      size="icon-sm"
      title="Dictate (runs on your device)"
      type="button"
      variant="ghost"
    >
      <Mic className="size-4" />
    </Button>
  );
}
