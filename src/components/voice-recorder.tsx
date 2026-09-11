"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  MAX_SEGMENTS_PER_SESSION,
  SEGMENT_MAX_MS,
  SEGMENT_SOFT_WARN_MS,
  TRANSCRIBE_CONCURRENCY,
  applyTranscriptResult,
  assembleTranscript,
  cancelCurrentRecordingSegment,
  countByStatus,
  createSegmentId,
  createSessionId,
  discardSegment,
  discardedGapNotice,
  hasRecoverableAudioRisk,
  hasUnresolvedSegments,
  markSegmentFailed,
  nextSequence,
  progressLabel,
  type VoiceSegment,
} from "@/lib/voice-segments";
import { useNavigationGuard } from "@/components/navigation-guard";

type UiPhase =
  | "idle"
  | "recording"
  | "between"
  | "finishing"
  | "review"
  | "failed_start";

type AudioHold = {
  blob: Blob;
  mimeType: string;
};

function resolveSegmentLimitMs(): number {
  if (typeof window !== "undefined") {
    const override = (window as unknown as { __GUNCE_VOICE_SEGMENT_MS?: number })
      .__GUNCE_VOICE_SEGMENT_MS;
    if (typeof override === "number" && override >= 200 && override <= SEGMENT_MAX_MS) {
      return override;
    }
  }
  return SEGMENT_MAX_MS;
}

function resolveSoftWarnMs(limitMs: number): number {
  if (limitMs <= 1000) return Math.max(100, Math.floor(limitMs * 0.7));
  return Math.min(SEGMENT_SOFT_WARN_MS, limitMs - 15_000);
}

export function VoiceRecorder({
  entryId,
  expectedRevision,
  disabled,
  onApplied,
}: {
  entryId: string;
  expectedRevision: number;
  disabled?: boolean;
  onApplied: (entry: unknown, transcript: string) => void;
}) {
  const [phase, setPhase] = useState<UiPhase>("idle");
  const [segments, setSegments] = useState<VoiceSegment[]>([]);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [softWarn, setSoftWarn] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [notice, setNotice] = useState<string | undefined>();
  const [assembledDraft, setAssembledDraft] = useState("");
  const [showParts, setShowParts] = useState(false);
  const [busyGuard, setBusyGuard] = useState(false);
  const { registerVoiceGuard } = useNavigationGuard();

  const mediaRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const hardStopRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const softWarnRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const currentSegmentIdRef = useRef<string | null>(null);
  const stopReasonRef = useRef<"limit" | "manual" | "cancel" | null>(null);
  const audioBySegmentRef = useRef<Map<string, AudioHold>>(new Map());
  const inflightRef = useRef<Set<string>>(new Set());
  const queueRef = useRef<string[]>([]);
  const activeJobsRef = useRef(0);
  const appliedOnceRef = useRef(false);
  const startingRef = useRef(false);
  const segmentsRef = useRef<VoiceSegment[]>([]);
  const sessionIdRef = useRef<string | null>(null);
  const revisionRef = useRef(expectedRevision);
  const limitMsRef = useRef(SEGMENT_MAX_MS);
  const abandonGenerationRef = useRef(0);
  const phaseRef = useRef<UiPhase>("idle");

  useEffect(() => {
    segmentsRef.current = segments;
  }, [segments]);
  useEffect(() => {
    sessionIdRef.current = sessionId;
  }, [sessionId]);
  useEffect(() => {
    revisionRef.current = expectedRevision;
  }, [expectedRevision]);
  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);

  const stopTracks = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
    if (hardStopRef.current) clearTimeout(hardStopRef.current);
    hardStopRef.current = null;
    if (softWarnRef.current) clearTimeout(softWarnRef.current);
    softWarnRef.current = null;
  }, []);

  const releaseAudio = useCallback((segmentId: string) => {
    audioBySegmentRef.current.delete(segmentId);
  }, []);

  const releaseAllAudio = useCallback(() => {
    audioBySegmentRef.current.clear();
  }, []);

  useEffect(() => {
    return () => {
      try {
        mediaRef.current?.stop();
      } catch {
        /* ignore */
      }
      stopTracks();
      releaseAllAudio();
    };
  }, [releaseAllAudio, stopTracks]);

  useEffect(() => {
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (hasRecoverableAudioRisk(segmentsRef.current) || phase === "recording") {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [phase]);

  const discardPendingVoice = useCallback(() => {
    abandonGenerationRef.current += 1;
    phaseRef.current = "idle";
    try {
      mediaRef.current?.stop();
    } catch {
      /* ignore */
    }
    mediaRef.current = null;
    stopTracks();
    releaseAllAudio();
    queueRef.current = [];
    inflightRef.current.clear();
    activeJobsRef.current = 0;
    currentSegmentIdRef.current = null;
    stopReasonRef.current = "cancel";
    appliedOnceRef.current = false;
    startingRef.current = false;
    segmentsRef.current = [];
    setSegments([]);
    setSessionId(null);
    sessionIdRef.current = null;
    setAssembledDraft("");
    setPhase("idle");
    setError(undefined);
    setNotice(undefined);
    setSoftWarn(false);
    setElapsed(0);
    setBusyGuard(false);
  }, [releaseAllAudio, stopTracks]);

  useEffect(() => {
    registerVoiceGuard({
      isBlocking: () => {
        const p = phaseRef.current;
        return (
          p === "recording" ||
          p === "between" ||
          p === "finishing" ||
          p === "review" ||
          hasRecoverableAudioRisk(segmentsRef.current)
        );
      },
      message: () => {
        const p = phaseRef.current;
        if (p === "recording") {
          return "Kayıt sürüyor. Çıkarsan bu ses kaybolur (ses dosyası saklanmaz).";
        }
        if (p === "review") {
          return "Henüz yazına eklenmemiş bir ses çözümü var. Çıkarsan bu çözüm kaybolur; yazındaki kayıtlı metin durur.";
        }
        if (
          hasUnresolvedSegments(segmentsRef.current) ||
          hasRecoverableAudioRisk(segmentsRef.current)
        ) {
          return "Henüz bitmemiş veya yazına eklenmemiş ses bölümlerin var. Çıkarsan bunlar kaybolur.";
        }
        return "Kaydedilmemiş ses çalışman var. Çıkarsan kaybolur.";
      },
      discard: discardPendingVoice,
    });
    return () => registerVoiceGuard(null);
  }, [discardPendingVoice, registerVoiceGuard]);

  const pumpQueue = useCallback(() => {
    while (
      activeJobsRef.current < TRANSCRIBE_CONCURRENCY &&
      queueRef.current.length > 0
    ) {
      const nextId = queueRef.current.shift();
      if (!nextId) break;
      if (inflightRef.current.has(nextId)) continue;
      const hold = audioBySegmentRef.current.get(nextId);
      const seg = segmentsRef.current.find((s) => s.id === nextId);
      if (!hold || !seg || seg.status === "discarded" || seg.status === "cancelled") {
        continue;
      }
      if (seg.status === "completed" && seg.transcript.trim()) {
        releaseAudio(nextId);
        continue;
      }

      inflightRef.current.add(nextId);
      activeJobsRef.current += 1;
      const generationAtStart = abandonGenerationRef.current;
      setSegments((prev) =>
        prev.map((s) =>
          s.id === nextId && s.status !== "completed"
            ? { ...s, status: "transcribing" as const }
            : s,
        ),
      );

      void (async () => {
        const form = new FormData();
        form.append("audio", hold.blob, "recording.webm");
        form.append("expectedRevision", String(revisionRef.current));
        form.append("apply", "false");
        form.append("segmentId", nextId);
        form.append("sessionId", sessionIdRef.current || "");
        form.append("sequence", String(seg.sequence));

        try {
          const res = await fetch(`/api/child/journal/${entryId}/transcribe`, {
            method: "POST",
            body: form,
          });
          const data = (await res.json()) as {
            transcript?: string;
            error?: string;
            notice?: string;
          };

          if (abandonGenerationRef.current !== generationAtStart) {
            return;
          }

          const latest = segmentsRef.current.find((s) => s.id === nextId);
          if (
            !latest ||
            latest.status === "discarded" ||
            latest.status === "cancelled"
          ) {
            return;
          }

          if (res.status === 401) {
            setSegments((prev) =>
              markSegmentFailed(
                prev,
                nextId,
                "Oturumun sona erdi. Bu bölüm için ses bu ekranda duruyor; yeniden giriş yapıp deneyebilirsin.",
              ),
            );
            return;
          }
          if (res.status === 404 || res.status === 410) {
            setSegments((prev) =>
              markSegmentFailed(prev, nextId, "Kayıt silindiği için bu bölüm kaydedilmedi."),
            );
            releaseAudio(nextId);
            return;
          }
          if (!res.ok || !data.transcript?.trim()) {
            setSegments((prev) =>
              markSegmentFailed(
                prev,
                nextId,
                data.error || "Bu bölüm çevrilemedi. Yeniden dene.",
              ),
            );
            return;
          }

          setNotice(data.notice);
          setSegments((prev) => applyTranscriptResult(prev, nextId, data.transcript!));
          releaseAudio(nextId);
        } catch {
          setSegments((prev) =>
            markSegmentFailed(
              prev,
              nextId,
              "Bağlantı hatası. Bu bölümün sesi bu ekranda duruyor; yeniden deneyebilirsin.",
            ),
          );
        } finally {
          inflightRef.current.delete(nextId);
          activeJobsRef.current = Math.max(0, activeJobsRef.current - 1);
          pumpQueue();
        }
      })();
    }
  }, [entryId, releaseAudio]);

  const enqueueTranscribe = useCallback(
    (segmentId: string) => {
      if (!queueRef.current.includes(segmentId) && !inflightRef.current.has(segmentId)) {
        queueRef.current.push(segmentId);
      }
      setSegments((prev) =>
        prev.map((s) =>
          s.id === segmentId && s.status !== "completed" && s.status !== "transcribing"
            ? { ...s, status: "pending" as const }
            : s,
        ),
      );
      pumpQueue();
    },
    [pumpQueue],
  );

  const finalizeRecorderToBlob = useCallback((): Promise<Blob | null> => {
    return new Promise((resolve) => {
      const recorder = mediaRef.current;
      if (!recorder || recorder.state === "inactive") {
        const blob = new Blob(chunksRef.current, {
          type: chunksRef.current[0]?.type || "audio/webm",
        });
        chunksRef.current = [];
        resolve(blob.size > 0 ? blob : null);
        return;
      }

      const onStop = () => {
        recorder.removeEventListener("stop", onStop);
        const blob = new Blob(chunksRef.current, {
          type: chunksRef.current[0]?.type || recorder.mimeType || "audio/webm",
        });
        chunksRef.current = [];
        resolve(blob.size > 0 ? blob : null);
      };
      recorder.addEventListener("stop", onStop);
      try {
        if (recorder.state === "recording") {
          recorder.requestData();
        }
      } catch {
        /* some browsers lack requestData */
      }
      try {
        recorder.stop();
      } catch {
        onStop();
      }
    });
  }, []);

  const endCurrentSegmentRef = useRef<(reason: "limit" | "manual" | "cancel") => Promise<void>>(
    async () => undefined,
  );

  const endCurrentSegment = useCallback(
    async (reason: "limit" | "manual" | "cancel") => {
      if (busyGuard && reason !== "limit") return;
      setBusyGuard(true);
      stopReasonRef.current = reason;
      const segmentId = currentSegmentIdRef.current;

      if (timerRef.current) clearInterval(timerRef.current);
      timerRef.current = null;
      if (hardStopRef.current) clearTimeout(hardStopRef.current);
      hardStopRef.current = null;
      if (softWarnRef.current) clearTimeout(softWarnRef.current);
      softWarnRef.current = null;
      setSoftWarn(false);

      const blob = await finalizeRecorderToBlob();
      mediaRef.current = null;
      stopTracks();
      currentSegmentIdRef.current = null;

      if (!segmentId) {
        setBusyGuard(false);
        setPhase(segmentsRef.current.some((s) => s.status === "completed") ? "between" : "idle");
        return;
      }

      if (reason === "cancel") {
        setSegments((prev) => cancelCurrentRecordingSegment(prev, segmentId));
        releaseAudio(segmentId);
        const others = segmentsRef.current.filter(
          (s) =>
            s.id !== segmentId &&
            (s.status === "completed" ||
              s.status === "pending" ||
              s.status === "transcribing" ||
              s.status === "failed"),
        );
        setBusyGuard(false);
        setPhase(others.length > 0 ? "between" : "idle");
        return;
      }

      if (!blob) {
        setSegments((prev) =>
          markSegmentFailed(prev, segmentId, "Kayıt boş geldi. Yeniden dene veya yazarak devam et."),
        );
        setBusyGuard(false);
        setPhase("between");
        return;
      }

      audioBySegmentRef.current.set(segmentId, {
        blob,
        mimeType: blob.type || "audio/webm",
      });
      enqueueTranscribe(segmentId);
      setBusyGuard(false);
      setPhase("between");
    },
    [busyGuard, enqueueTranscribe, finalizeRecorderToBlob, releaseAudio, stopTracks],
  );

  useEffect(() => {
    endCurrentSegmentRef.current = endCurrentSegment;
  }, [endCurrentSegment]);
  // Keep ref fresh synchronously for short segment-limit timeouts in tests.
  endCurrentSegmentRef.current = endCurrentSegment;

  const beginSegmentRecording = useCallback(async () => {
    if (startingRef.current || busyGuard) return;
    startingRef.current = true;
    setError(undefined);
    setSoftWarn(false);

    if (typeof window === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      setPhase("failed_start");
      setError("Bu cihazda mikrofon kullanılamıyor. Yazarak devam edebilirsin.");
      startingRef.current = false;
      return;
    }

    const activeCount = segmentsRef.current.filter(
      (s) => s.status !== "cancelled" && s.status !== "discarded",
    ).length;
    if (activeCount >= MAX_SEGMENTS_PER_SESSION) {
      setError(
        `Bu anlatımda en fazla ${MAX_SEGMENTS_PER_SESSION} bölüm olabilir. Bitirdim diyerek yazıya bakabilirsin.`,
      );
      setPhase("between");
      startingRef.current = false;
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      chunksRef.current = [];

      let sid = sessionIdRef.current;
      if (!sid) {
        sid = createSessionId();
        setSessionId(sid);
        sessionIdRef.current = sid;
      }

      const segmentId = createSegmentId();
      const sequence = nextSequence(segmentsRef.current);
      currentSegmentIdRef.current = segmentId;
      stopReasonRef.current = null;
      appliedOnceRef.current = false;

      setSegments((prev) => [
        ...prev,
        {
          id: segmentId,
          sequence,
          status: "recording",
          transcript: "",
        },
      ]);

      const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : MediaRecorder.isTypeSupported("audio/webm")
          ? "audio/webm"
          : "";

      const recorder = mimeType
        ? new MediaRecorder(stream, { mimeType })
        : new MediaRecorder(stream);
      mediaRef.current = recorder;
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      };

      limitMsRef.current = resolveSegmentLimitMs();
      const softMs = resolveSoftWarnMs(limitMsRef.current);

      recorder.start(250);
      setPhase("recording");
      setElapsed(0);
      timerRef.current = setInterval(() => setElapsed((e) => e + 1), 1000);
      softWarnRef.current = setTimeout(() => setSoftWarn(true), softMs);
      hardStopRef.current = setTimeout(() => {
        stopReasonRef.current = "limit";
        void endCurrentSegmentRef.current("limit");
      }, limitMsRef.current);
    } catch {
      stopTracks();
      setPhase("failed_start");
      setError("Mikrofon izni verilmedi veya mikrofon yok. Yazarak devam edebilirsin.");
    } finally {
      startingRef.current = false;
    }
  }, [busyGuard, stopTracks]);

  async function startSession() {
    setSegments([]);
    setSessionId(null);
    sessionIdRef.current = null;
    releaseAllAudio();
    queueRef.current = [];
    appliedOnceRef.current = false;
    await beginSegmentRecording();
  }

  async function continueSession() {
    await beginSegmentRecording();
  }

  async function finishSession() {
    if (phase === "recording") {
      await endCurrentSegment("manual");
    }
    setPhase("finishing");
    appliedOnceRef.current = false;

    // Wait briefly for pending jobs; UI stays on finishing until resolved or failed remain.
    const waitForIdle = () =>
      new Promise<void>((resolve) => {
        const tick = () => {
          const unresolved = segmentsRef.current.some(
            (s) => s.status === "pending" || s.status === "transcribing",
          );
          if (!unresolved && activeJobsRef.current === 0) {
            resolve();
            return;
          }
          setTimeout(tick, 200);
        };
        tick();
      });

    await waitForIdle();

    if (hasUnresolvedSegments(segmentsRef.current.filter((s) => s.status !== "recording"))) {
      // Stay in finishing with failed segments visible via between-like controls
      setPhase("between");
      setError("Bazı bölümler henüz hazır değil. Yeniden dene veya atlayıp bitirebilirsin.");
      return;
    }

    const text = assembleTranscript(segmentsRef.current);
    setAssembledDraft(text);
    setPhase("review");
  }

  async function retrySegment(segmentId: string) {
    const hold = audioBySegmentRef.current.get(segmentId);
    if (!hold) {
      setError("Bu bölümün sesi artık yok (sayfa yenilendiyse kaybolur). Yeni bölüm kaydedebilirsin.");
      return;
    }
    setError(undefined);
    setSegments((prev) =>
      prev.map((s) =>
        s.id === segmentId
          ? { ...s, status: "pending" as const, error: undefined }
          : s,
      ),
    );
    enqueueTranscribe(segmentId);
  }

  function discardFailedSegment(segmentId: string) {
    setSegments((prev) => discardSegment(prev, segmentId));
    releaseAudio(segmentId);
    setError(undefined);
  }

  async function confirmReview(mode: "append" | "replace") {
    if (appliedOnceRef.current) return;
    const text = assembledDraft.trim();
    if (!text) {
      setError("Eklenecek metin yok.");
      return;
    }
    appliedOnceRef.current = true;
    onApplied(
      {
        __applyTranscriptLocally: true,
        transcript: text,
        mode,
        skipTranscriptRow: true,
      },
      text,
    );
    releaseAllAudio();
    setPhase("idle");
    setSegments([]);
    setSessionId(null);
    setAssembledDraft("");
  }

  const counts = countByStatus(segments);
  const gapNotice = discardedGapNotice(segments);
  const limitSec = Math.round(limitMsRef.current / 1000);
  const currentSeq =
    segments.find((s) => s.id === currentSegmentIdRef.current)?.sequence ??
    nextSequence(segments);

  return (
    <div className="space-y-3 rounded-2xl border p-4" style={{ borderColor: "var(--line)" }}>
      <p className="text-sm leading-relaxed" style={{ color: "var(--muted)" }}>
        İstersen mikrofonla anlatabilirsin. Her bölüm en fazla {limitSec} saniye sürer; bitince devam
        edebilirsin. Ses yalnızca yazıya çevirmek için gönderilir; uygulamada ses dosyası saklanmaz.
        İşlenmemiş ses sayfa kapanınca kaybolur.
      </p>

      {phase === "idle" || phase === "failed_start" ? (
        <button
          type="button"
          disabled={disabled || busyGuard}
          onClick={() => void startSession()}
          className="inline-flex min-h-12 w-full items-center justify-center rounded-2xl px-4 text-base font-semibold disabled:opacity-50"
          style={{ background: "var(--accent-soft)", color: "var(--ink)" }}
        >
          Mikrofonla anlat
        </button>
      ) : null}

      {phase === "recording" ? (
        <div className="space-y-2">
          <p className="font-semibold" aria-live="polite">
            Anlatımın {currentSeq}. bölümü · {elapsed}s / {limitSec}s
          </p>
          {softWarn ? (
            <p className="text-sm" style={{ color: "var(--warn)" }} role="status">
              Bu bölüm birazdan bitecek. Sonra anlatmaya devam edebilirsin.
            </p>
          ) : null}
          <div className="flex flex-col gap-2 sm:flex-row">
            <button
              type="button"
              disabled={busyGuard}
              onClick={() => void endCurrentSegment("manual")}
              className="inline-flex min-h-12 flex-1 items-center justify-center rounded-2xl px-4 font-semibold disabled:opacity-50"
              style={{ background: "var(--accent)", color: "white" }}
            >
              Durdur
            </button>
            <button
              type="button"
              disabled={busyGuard}
              onClick={() => void endCurrentSegment("cancel")}
              className="inline-flex min-h-12 flex-1 items-center justify-center rounded-2xl px-4 font-semibold disabled:opacity-50"
              style={{ border: "1px solid var(--line)" }}
            >
              Bu bölümü iptal et
            </button>
          </div>
          {counts.completed > 0 || counts.pending > 0 || counts.transcribing > 0 ? (
            <p className="text-xs" style={{ color: "var(--muted)" }}>
              {progressLabel(segments)}
            </p>
          ) : null}
        </div>
      ) : null}

      {phase === "between" || phase === "finishing" ? (
        <div className="space-y-3">
          <p className="font-semibold" aria-live="polite">
            {phase === "finishing" ? "Bölümler tamamlanıyor…" : progressLabel(segments)}
          </p>
          {segments
            .filter((s) => s.status === "failed")
            .map((s) => (
              <div
                key={s.id}
                className="space-y-2 rounded-2xl border p-3"
                style={{ borderColor: "var(--line)" }}
              >
                <p className="text-sm" style={{ color: "var(--danger)" }}>
                  {s.sequence}. bölüm çevrilemedi. Yeniden dene.
                </p>
                {s.error ? (
                  <p className="text-xs" style={{ color: "var(--muted)" }}>
                    {s.error}
                  </p>
                ) : null}
                <div className="flex flex-col gap-2 sm:flex-row">
                  <button
                    type="button"
                    onClick={() => void retrySegment(s.id)}
                    className="inline-flex min-h-11 flex-1 items-center justify-center rounded-2xl px-3 text-sm font-semibold"
                    style={{ background: "var(--accent-soft)" }}
                  >
                    Bu bölümü yeniden dene
                  </button>
                  <button
                    type="button"
                    onClick={() => discardFailedSegment(s.id)}
                    className="inline-flex min-h-11 flex-1 items-center justify-center rounded-2xl px-3 text-sm font-semibold"
                    style={{ border: "1px solid var(--line)" }}
                  >
                    Bu bölümü atla
                  </button>
                </div>
              </div>
            ))}
          {gapNotice ? (
            <p className="text-sm" style={{ color: "var(--warn)" }} role="status">
              {gapNotice}
            </p>
          ) : null}
          {phase === "between" ? (
            <div className="flex flex-col gap-2">
              <button
                type="button"
                disabled={busyGuard || startingRef.current}
                onClick={() => void continueSession()}
                className="inline-flex min-h-12 items-center justify-center rounded-2xl px-4 font-semibold disabled:opacity-50"
                style={{ background: "var(--accent)", color: "white" }}
              >
                Devam et
              </button>
              <button
                type="button"
                disabled={busyGuard}
                onClick={() => void finishSession()}
                className="inline-flex min-h-12 items-center justify-center rounded-2xl px-4 font-semibold disabled:opacity-50"
                style={{ background: "var(--accent-soft)" }}
              >
                Bitirdim
              </button>
            </div>
          ) : null}
        </div>
      ) : null}

      {phase === "review" ? (
        <div className="space-y-3">
          <p className="text-sm font-semibold">Çözümlenen metin (henüz kayda eklenmedi)</p>
          {gapNotice ? (
            <p className="text-sm" style={{ color: "var(--warn)" }}>
              {gapNotice}
            </p>
          ) : null}
          <textarea
            value={assembledDraft}
            onChange={(e) => {
              appliedOnceRef.current = false;
              setAssembledDraft(e.target.value);
            }}
            rows={8}
            maxLength={8000}
            className="w-full rounded-2xl border p-3 text-base"
            style={{ borderColor: "var(--line)", background: "white" }}
            aria-label="Çözümlenen anlatım"
          />
          <button
            type="button"
            onClick={() => setShowParts((v) => !v)}
            className="text-sm font-semibold underline"
          >
            {showParts ? "Bölümleri gizle" : "Bölümleri göster"}
          </button>
          {showParts ? (
            <ul className="space-y-2 text-sm">
              {segments
                .filter((s) => s.status === "completed" || s.status === "discarded")
                .sort((a, b) => a.sequence - b.sequence)
                .map((s) => (
                  <li
                    key={s.id}
                    className="rounded-xl border p-2"
                    style={{ borderColor: "var(--line)" }}
                  >
                    <p className="font-semibold">
                      {s.sequence}. bölüm
                      {s.status === "discarded" ? " (atlandı)" : ""}
                    </p>
                    <p className="whitespace-pre-wrap" style={{ color: "var(--muted)" }}>
                      {s.status === "discarded" ? "—" : s.transcript}
                    </p>
                  </li>
                ))}
            </ul>
          ) : null}
          {notice ? (
            <p className="text-xs" style={{ color: "var(--muted)" }}>
              {notice}
            </p>
          ) : null}
          <div className="flex flex-col gap-2">
            <button
              type="button"
              onClick={() => void confirmReview("append")}
              className="inline-flex min-h-12 items-center justify-center rounded-2xl px-4 font-semibold"
              style={{ background: "var(--accent)", color: "white" }}
            >
              Yazıma ekle
            </button>
            <button
              type="button"
              onClick={() => void confirmReview("replace")}
              className="inline-flex min-h-12 items-center justify-center rounded-2xl px-4 font-semibold"
              style={{ background: "var(--accent-soft)" }}
            >
              Yazımın yerine koy
            </button>
            <button
              type="button"
              onClick={() => {
                releaseAllAudio();
                setPhase("idle");
                setSegments([]);
                setAssembledDraft("");
              }}
              className="inline-flex min-h-12 items-center justify-center rounded-2xl px-4 font-semibold"
              style={{ border: "1px solid var(--line)" }}
            >
              Vazgeç
            </button>
          </div>
        </div>
      ) : null}

      {error ? (
        <p className="text-sm" style={{ color: "var(--danger)" }} role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
