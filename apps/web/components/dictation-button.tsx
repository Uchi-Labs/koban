"use client";

import { Mic, Square } from "lucide-react";
import * as React from "react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { VoiceWaveform } from "@/components/ui/voice-waveform";
import { isDictationSupported, loadDictationModel, transcribeRecording, type DictationProgress } from "@/lib/dictation";
import { cn } from "@/lib/utils";

const maxRecordingMs = 60_000;

type DictationState =
  | { kind: "idle" }
  | { kind: "recording"; startedAt: number }
  | { kind: "transcribing" }
  | { kind: "error"; message: string };

/**
 * Tap to record, tap again to stop; the transcript is handed to `onText`.
 * The speech model starts downloading as soon as recording starts, so most of
 * a first-time download overlaps with speaking.
 */
export function DictationButton({ className, disabled, onText }: {
  className?: string;
  disabled?: boolean;
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

  const downloading = progress !== null && progress.totalBytes > 0 && progress.loadedBytes < progress.totalBytes;
  const percent = downloading ? Math.round((progress.loadedBytes / progress.totalBytes) * 100) : null;

  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      {state.kind === "recording" ? (
        <Button aria-label="Stop dictation" onClick={stop} size="sm" title="Stop and transcribe" type="button" variant="outline">
          <VoiceWaveform bars={5} className="text-(--negative)" height={14} label="Listening" />
          <span className="tabular-nums">{`0:${String(elapsed).padStart(2, "0")}`}</span>
          <Square className="size-3 fill-current" />
        </Button>
      ) : state.kind === "transcribing" ? (
        <span className="inline-flex h-8 items-center gap-2 px-2 text-xs text-muted-foreground" role="status">
          <Spinner decorative size="sm" variant="ring" />
          {percent !== null ? `Getting the voice model ready, ${percent}%` : "Transcribing…"}
        </span>
      ) : (
        <Button
          aria-label="Dictate context"
          disabled={disabled}
          onClick={() => void start()}
          size="icon-sm"
          title="Dictate (runs on your device)"
          type="button"
          variant="ghost"
        >
          <Mic className="size-4" />
        </Button>
      )}
      {state.kind === "recording" && percent !== null ? (
        <span className="text-xs text-muted-foreground tabular-nums">Voice model {percent}%</span>
      ) : null}
      {state.kind === "error" ? (
        <span className="text-xs text-(--negative)" role="alert">
          {state.message}
        </span>
      ) : null}
    </span>
  );
}
