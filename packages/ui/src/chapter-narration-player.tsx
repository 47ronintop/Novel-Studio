import { Pause, Play, Square, Volume2, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

const MAX_NARRATION_CHUNK_LENGTH = 240;
const NARRATION_RATES = [0.75, 1, 1.25, 1.5, 2] as const;

type NarrationStatus = "idle" | "playing" | "paused" | "unsupported";

export interface ChapterNarrationPlayerProps {
  readonly body: string;
}

/** Splits long prose into short utterances so browser speech does not stall on a full chapter. */
export function splitNarrationText(body: string): readonly string[] {
  const chunks: string[] = [];

  for (const paragraph of body.split(/\r?\n+/)) {
    const sentences = paragraph.match(/[^。！？!?…]+[。！？!?…]*/g) ?? [paragraph];
    for (const sentence of sentences) {
      const text = sentence.trim();
      if (text.length === 0) {
        continue;
      }

      for (let start = 0; start < text.length; start += MAX_NARRATION_CHUNK_LENGTH) {
        chunks.push(text.slice(start, start + MAX_NARRATION_CHUNK_LENGTH));
      }
    }
  }

  return chunks;
}

export function ChapterNarrationPlayer({ body }: ChapterNarrationPlayerProps) {
  const hasNarratableText = body.trim().length > 0;
  const [open, setOpen] = useState(false);
  const [rate, setRate] = useState<number>(1);
  const [status, setStatus] = useState<NarrationStatus>("idle");
  const bodyRef = useRef(body);
  const chunksRef = useRef<readonly string[]>([]);
  const chunkIndexRef = useRef(0);
  const rateRef = useRef(rate);
  const runIdRef = useRef(0);
  const voiceRef = useRef<SpeechSynthesisVoice | null>(null);

  const cancelNarration = useCallback(() => {
    runIdRef.current += 1;
    chunkIndexRef.current = 0;
    const synthesis = getSpeechSynthesis();
    synthesis?.cancel();
    if (synthesis?.paused === true) {
      synthesis.resume();
    }
  }, []);

  const stopNarration = useCallback(() => {
    cancelNarration();
    setStatus(canUseSpeechSynthesis() ? "idle" : "unsupported");
  }, [cancelNarration]);

  const speakChunk = useCallback((runId: number) => {
    const synthesis = getSpeechSynthesis();
    const text = chunksRef.current[chunkIndexRef.current];
    if (synthesis === undefined || text === undefined) {
      setStatus("idle");
      return;
    }

    const utterance = new window.SpeechSynthesisUtterance(text);
    utterance.lang = "zh-CN";
    utterance.rate = rateRef.current;
    if (voiceRef.current !== null) {
      utterance.voice = voiceRef.current;
    }
    utterance.onend = () => {
      if (runId !== runIdRef.current) {
        return;
      }

      chunkIndexRef.current += 1;
      if (chunkIndexRef.current >= chunksRef.current.length) {
        setStatus("idle");
        return;
      }

      speakChunk(runId);
    };
    utterance.onerror = () => {
      if (runId === runIdRef.current) {
        setStatus("idle");
      }
    };
    synthesis.speak(utterance);
  }, []);

  const startNarration = useCallback(() => {
    if (!canUseSpeechSynthesis()) {
      setStatus("unsupported");
      return;
    }

    const chunks = splitNarrationText(body);
    if (chunks.length === 0) {
      setStatus("idle");
      return;
    }

    const synthesis = getSpeechSynthesis();
    if (synthesis === undefined) {
      setStatus("unsupported");
      return;
    }

    runIdRef.current += 1;
    chunksRef.current = chunks;
    chunkIndexRef.current = 0;
    synthesis.cancel();
    if (synthesis.paused) {
      synthesis.resume();
    }
    setStatus("playing");
    speakChunk(runIdRef.current);
  }, [body, speakChunk]);

  const pauseNarration = useCallback(() => {
    getSpeechSynthesis()?.pause();
    setStatus("paused");
  }, []);

  const resumeNarration = useCallback(() => {
    getSpeechSynthesis()?.resume();
    setStatus("playing");
  }, []);

  useEffect(() => {
    const synthesis = getSpeechSynthesis();
    if (synthesis === undefined || typeof window.SpeechSynthesisUtterance !== "function") {
      setStatus("unsupported");
      return;
    }

    const refreshVoices = () => {
      const voices = synthesis.getVoices();
      voiceRef.current =
        voices.find((voice) => voice.lang.toLocaleLowerCase() === "zh-cn") ??
        voices.find((voice) => voice.lang.toLocaleLowerCase().startsWith("zh")) ??
        null;
    };
    refreshVoices();
    synthesis.addEventListener("voiceschanged", refreshVoices);
    return () => synthesis.removeEventListener("voiceschanged", refreshVoices);
  }, []);

  useEffect(() => {
    if (bodyRef.current === body) {
      return;
    }

    bodyRef.current = body;
    stopNarration();
  }, [body, stopNarration]);

  useEffect(() => () => cancelNarration(), [cancelNarration]);

  const closePlayer = () => {
    stopNarration();
    setOpen(false);
  };

  const togglePlayer = () => {
    if (open) {
      closePlayer();
      return;
    }

    setOpen(true);
  };

  const toggleNarration = () => {
    if (status === "playing") {
      pauseNarration();
    } else if (status === "paused") {
      resumeNarration();
    } else {
      startNarration();
    }
  };

  return (
    <section className="ns-chapter-narration" aria-label="章节朗读">
      <button
        aria-controls="chapter-narration-player"
        aria-expanded={open}
        className="ns-chapter-narration-trigger"
        onClick={togglePlayer}
        type="button"
      >
        <Volume2 aria-hidden="true" size={14} />
        <span>朗读</span>
      </button>

      {open ? (
        <div
          aria-label="章节朗读播放器"
          className="ns-chapter-narration-player"
          id="chapter-narration-player"
        >
          <button
            aria-label={
              status === "playing" ? "暂停朗读" : status === "paused" ? "继续朗读" : "播放朗读"
            }
            className="ns-chapter-narration-control ns-chapter-narration-control-primary"
            disabled={status === "unsupported" || !hasNarratableText}
            onClick={toggleNarration}
            type="button"
          >
            {status === "playing" ? (
              <Pause aria-hidden="true" size={14} />
            ) : (
              <Play aria-hidden="true" size={14} />
            )}
            <span>{status === "playing" ? "暂停" : status === "paused" ? "继续" : "播放"}</span>
          </button>
          <button
            aria-label="停止朗读"
            className="ns-chapter-narration-control"
            disabled={status === "idle" || status === "unsupported"}
            onClick={stopNarration}
            type="button"
          >
            <Square aria-hidden="true" size={13} />
            <span>停止</span>
          </button>
          <label className="ns-chapter-narration-rate">
            <span>语速</span>
            <select
              aria-label="朗读语速"
              onChange={(event) => {
                const nextRate = Number(event.currentTarget.value);
                rateRef.current = nextRate;
                setRate(nextRate);
              }}
              value={rate}
            >
              {NARRATION_RATES.map((option) => (
                <option key={option} value={option}>
                  {option}x
                </option>
              ))}
            </select>
          </label>
          <span aria-live="polite" className="ns-chapter-narration-status">
            {narrationStatusLabel(status, hasNarratableText)}
          </span>
          <button
            aria-label="关闭朗读播放器"
            className="ns-icon-button"
            onClick={closePlayer}
            title="关闭朗读播放器"
            type="button"
          >
            <X aria-hidden="true" size={13} />
          </button>
        </div>
      ) : null}
    </section>
  );
}

function canUseSpeechSynthesis(): boolean {
  return (
    typeof window !== "undefined" &&
    "speechSynthesis" in window &&
    typeof window.SpeechSynthesisUtterance === "function"
  );
}

function getSpeechSynthesis(): SpeechSynthesis | undefined {
  return canUseSpeechSynthesis() ? window.speechSynthesis : undefined;
}

function narrationStatusLabel(status: NarrationStatus, hasNarratableText: boolean): string {
  if (!hasNarratableText && status !== "unsupported") {
    return "章节暂无正文";
  }

  switch (status) {
    case "playing":
      return "朗读中";
    case "paused":
      return "已暂停";
    case "unsupported":
      return "当前环境不支持系统语音";
    case "idle":
      return "准备朗读";
  }
}
