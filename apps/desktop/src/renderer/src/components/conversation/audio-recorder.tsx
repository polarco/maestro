import { useEffect, useRef, useState } from "react";
import { LoaderCircle, Mic, Pause, Play, Square, Trash2 } from "lucide-react";
import { Button } from "@renderer/components/ui/button";

type RecorderState = "idle" | "requesting" | "recording" | "paused" | "saving";

function durationLabel(milliseconds: number): string {
  const seconds = Math.floor(milliseconds / 1_000);
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

export function AudioRecorder({
  onSave,
  onClose,
}: {
  onSave: (data: Uint8Array, mimeType: string, durationMs: number) => Promise<void>;
  onClose: () => void;
}) {
  const [state, setState] = useState<RecorderState>("idle");
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const startedAtRef = useRef(0);
  const elapsedRef = useRef(0);
  const discardRef = useRef(false);

  const stopTracks = () => {
    recorderRef.current?.stream.getTracks().forEach((track) => track.stop());
  };

  useEffect(() => {
    if (state !== "recording") return;
    const interval = window.setInterval(() => {
      setElapsed(elapsedRef.current + performance.now() - startedAtRef.current);
    }, 200);
    return () => window.clearInterval(interval);
  }, [state]);

  useEffect(
    () => () => {
      discardRef.current = true;
      const recorder = recorderRef.current;
      if (recorder && recorder.state !== "inactive") recorder.stop();
      recorder?.stream.getTracks().forEach((track) => track.stop());
    },
    [],
  );

  const start = async () => {
    setError(null);
    setState("requesting");
    discardRef.current = false;
    let stream: MediaStream | null = null;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      if (discardRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      const preferred = ["audio/webm;codecs=opus", "audio/ogg;codecs=opus", "audio/mp4"].find(
        (type) => MediaRecorder.isTypeSupported(type),
      );
      const recorder = preferred
        ? new MediaRecorder(stream, { mimeType: preferred })
        : new MediaRecorder(stream);
      recorderRef.current = recorder;
      chunksRef.current = [];
      elapsedRef.current = 0;
      setElapsed(0);
      recorder.addEventListener("dataavailable", (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      });
      recorder.addEventListener("stop", () => {
        stopTracks();
        if (discardRef.current) return;
        const durationMs = Math.max(1, Math.round(elapsedRef.current));
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || "audio/webm" });
        setState("saving");
        void blob
          .arrayBuffer()
          .then((buffer) => onSave(new Uint8Array(buffer), blob.type, durationMs))
          .then(() => onClose())
          .catch((reason: unknown) => {
            setError(reason instanceof Error ? reason.message : String(reason));
            setState("idle");
          });
      });
      recorder.start(500);
      startedAtRef.current = performance.now();
      setState("recording");
    } catch (reason) {
      stream?.getTracks().forEach((track) => track.stop());
      stopTracks();
      if (discardRef.current) return;
      setError(
        reason instanceof Error
          ? reason.message
          : "Não foi possível acessar o microfone desta janela.",
      );
      setState("idle");
    }
  };

  const pause = () => {
    const recorder = recorderRef.current;
    if (!recorder || recorder.state !== "recording") return;
    elapsedRef.current += performance.now() - startedAtRef.current;
    setElapsed(elapsedRef.current);
    recorder.pause();
    setState("paused");
  };

  const resume = () => {
    const recorder = recorderRef.current;
    if (!recorder || recorder.state !== "paused") return;
    recorder.resume();
    startedAtRef.current = performance.now();
    setState("recording");
  };

  const finish = () => {
    const recorder = recorderRef.current;
    if (!recorder || recorder.state === "inactive") return;
    if (recorder.state === "recording") {
      elapsedRef.current += performance.now() - startedAtRef.current;
      setElapsed(elapsedRef.current);
    }
    recorder.stop();
  };

  const discard = () => {
    discardRef.current = true;
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== "inactive") recorder.stop();
    stopTracks();
    onClose();
  };

  return (
    <div className="audio-recorder" role="group" aria-label="Gravação de áudio">
      <span className="audio-recorder-dot" data-active={state === "recording"} />
      <span className="min-w-12 font-mono text-[11px] text-text-muted">
        {durationLabel(elapsed)}
      </span>
      {state === "idle" ? (
        <Button size="sm" onClick={() => void start()}>
          <Mic size={12} /> Gravar
        </Button>
      ) : state === "requesting" || state === "saving" ? (
        <span className="inline-flex items-center gap-1.5 text-[10px] text-text-faint">
          <LoaderCircle className="animate-spin" size={11} />
          {state === "requesting" ? "Autorizando…" : "Salvando…"}
        </span>
      ) : (
        <>
          <Button size="icon" variant="ghost" onClick={state === "paused" ? resume : pause}>
            {state === "paused" ? <Play size={13} /> : <Pause size={13} />}
          </Button>
          <Button size="sm" onClick={finish}>
            <Square size={11} /> Concluir
          </Button>
        </>
      )}
      <Button
        className="ml-auto"
        size="icon"
        variant="ghost"
        disabled={state === "saving"}
        onClick={discard}
      >
        <Trash2 size={13} />
      </Button>
      {error ? <span className="text-[10px] text-danger">{error}</span> : null}
    </div>
  );
}
