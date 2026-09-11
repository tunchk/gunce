"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ChildEntryView } from "@/lib/journal";
import { getAiFeatureStatusClientHint } from "@/lib/ai/client-status";
import { VoiceRecorder } from "@/components/voice-recorder";

type SaveState = "idle" | "saving" | "saved" | "failed" | "conflict";

export function JournalEditor({
  entryId,
  initial,
  features,
}: {
  entryId: string;
  initial: ChildEntryView;
  features: {
    transcriptionAvailable: boolean;
    summarizationAvailable: boolean;
    planExtractAvailable: boolean;
  };
}) {
  const [body, setBody] = useState(initial.body);
  const [revision, setRevision] = useState(initial.revision);
  const [originalBody, setOriginalBody] = useState(initial.originalBody);
  const [acceptedSummary, setAcceptedSummary] = useState(initial.acceptedSummary);
  const [suggestion, setSuggestion] = useState(initial.latestSuggestion);
  const [suggestionDraft, setSuggestionDraft] = useState(
    initial.latestSuggestion?.suggestedText ?? "",
  );
  const [showOriginal, setShowOriginal] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [error, setError] = useState<string | undefined>();
  const [summaryBusy, setSummaryBusy] = useState(false);
  const [summaryMsg, setSummaryMsg] = useState<string | undefined>();
  const latestRef = useRef({ body: initial.body, revision: initial.revision });
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const seqRef = useRef(0);
  const summarySeqRef = useRef(0);

  useEffect(() => {
    latestRef.current = { body, revision };
  }, [body, revision]);

  const applyEntry = useCallback((entry: ChildEntryView) => {
    setBody(entry.body);
    setRevision(entry.revision);
    setOriginalBody(entry.originalBody);
    setAcceptedSummary(entry.acceptedSummary);
    setSuggestion(entry.latestSuggestion);
    setSuggestionDraft(entry.latestSuggestion?.suggestedText ?? "");
    latestRef.current = { body: entry.body, revision: entry.revision };
  }, []);

  const save = useCallback(
    async (opts?: { markSaved?: boolean; bodyOverride?: string }) => {
      const seq = ++seqRef.current;
      const payloadBody = opts?.bodyOverride ?? latestRef.current.body;
      const expectedRevision = latestRef.current.revision;
      setSaveState("saving");
      setError(undefined);

      try {
        const res = await fetch(`/api/child/journal/${entryId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            op: "update_body",
            body: payloadBody,
            expectedRevision,
            markSaved: opts?.markSaved ?? true,
          }),
        });
        const data = (await res.json()) as {
          entry?: ChildEntryView;
          error?: string;
        };

        if (seq !== seqRef.current) return false;

        if (res.status === 401) {
          setSaveState("failed");
          setError(
            "Oturumun sona erdi. Kaydedilmeyen metin bu cihazda duruyor; yeniden giriş yapıp kopyalayabilirsin.",
          );
          return false;
        }
        if (res.status === 409) {
          setSaveState("conflict");
          setError(data.error || "Başka bir değişiklik var. Sayfayı yenile.");
          return false;
        }
        if (!res.ok || !data.entry) {
          setSaveState("failed");
          setError(data.error || "Kaydedilemedi.");
          return false;
        }

        applyEntry(data.entry);
        setSaveState("saved");
        return true;
      } catch {
        if (seq === seqRef.current) {
          setSaveState("failed");
          setError("Bağlantı hatası. Metnin kaybolmadı; tekrar dene.");
        }
        return false;
      }
    },
    [applyEntry, entryId],
  );

  useEffect(() => {
    if (body === initial.body && revision === initial.revision) return;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      void save({ markSaved: false });
    }, 900);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [body, initial.body, initial.revision, revision, save]);

  async function applyReviewedTranscript(
    transcript: string,
    mode: "append" | "replace",
    skipTranscriptRow = false,
  ) {
    if (timerRef.current) clearTimeout(timerRef.current);
    setSaveState("saving");
    setError(undefined);
    try {
      const res = await fetch(`/api/child/journal/${entryId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          op: "apply_transcript",
          transcript,
          expectedRevision: latestRef.current.revision,
          mode,
          skipTranscriptRow,
        }),
      });
      const data = (await res.json()) as { entry?: ChildEntryView; error?: string };
      if (!res.ok || !data.entry) {
        setSaveState("failed");
        setError(data.error || "Çözümlenen metin eklenemedi.");
        return;
      }
      applyEntry(data.entry);
      setSaveState("saved");
    } catch {
      setSaveState("failed");
      setError("Bağlantı hatası. Yazın bu ekranda duruyor.");
    }
  }

  async function requestSummary() {
    setSummaryBusy(true);
    setSummaryMsg(undefined);
    setError(undefined);
    const seq = ++summarySeqRef.current;
    const requestId =
      typeof crypto !== "undefined" && crypto.randomUUID
        ? crypto.randomUUID()
        : `sum_${Date.now()}`;

    // Ensure latest text is saved first
    if (timerRef.current) clearTimeout(timerRef.current);
    const saved = await save({ markSaved: true });
    if (!saved) {
      setSummaryBusy(false);
      return;
    }

    const bodyAtRequest = latestRef.current.body;
    const revisionAtRequest = latestRef.current.revision;

    try {
      const res = await fetch(`/api/child/journal/${entryId}/summarize`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          expectedRevision: revisionAtRequest,
          requestId,
        }),
      });
      const data = (await res.json()) as {
        entry?: ChildEntryView;
        error?: string;
        code?: string;
      };

      if (seq !== summarySeqRef.current) {
        setSummaryBusy(false);
        return;
      }

      if (!res.ok || !data.entry) {
        setSummaryMsg(data.error || "Özet önerisi alınamadı. Yazın duruyor.");
        setSummaryBusy(false);
        return;
      }

      // Never overwrite newer local edits with a late response body.
      const localChanged =
        latestRef.current.body !== bodyAtRequest ||
        latestRef.current.revision !== revisionAtRequest;

      if (localChanged) {
        if (data.entry.latestSuggestion) {
          setSuggestion(data.entry.latestSuggestion);
          setSuggestionDraft(data.entry.latestSuggestion.suggestedText);
        }
        setSummaryMsg(
          "Öneri geldi ama sen yazmayı sürdürdün. Kabul etmeden önce metnini ve öneriyi kontrol et; gerekirse yeniden iste.",
        );
      } else {
        applyEntry(data.entry);
        setSummaryMsg("Önerilen özet hazır. Kabul etmeden yazın değişmez.");
      }
    } catch {
      if (seq === summarySeqRef.current) {
        setSummaryMsg("Bağlantı hatası. Yazın kayboldu sayılmaz.");
      }
    } finally {
      if (seq === summarySeqRef.current) setSummaryBusy(false);
    }
  }

  async function acceptSuggestion() {
    if (!suggestion) return;
    setSummaryBusy(true);
    try {
      const res = await fetch(`/api/child/journal/${entryId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          op: "accept_suggestion",
          suggestionId: suggestion.id,
          expectedRevision: revision,
          editedText: suggestionDraft,
        }),
      });
      const data = (await res.json()) as { entry?: ChildEntryView; error?: string };
      if (!res.ok || !data.entry) {
        setSummaryMsg(data.error || "Kabul edilemedi.");
        setSummaryBusy(false);
        return;
      }
      applyEntry(data.entry);
      setSummaryMsg("Özet kabul edildi. Paylaşmak için ayrıca ‘Paylaşımı hazırla’ adımına git.");
    } catch {
      setSummaryMsg("Bağlantı hatası.");
    } finally {
      setSummaryBusy(false);
    }
  }

  async function discardSuggestion() {
    if (!suggestion) return;
    setSummaryBusy(true);
    try {
      const res = await fetch(`/api/child/journal/${entryId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          op: "discard_suggestion",
          suggestionId: suggestion.id,
        }),
      });
      const data = (await res.json()) as { entry?: ChildEntryView; error?: string };
      if (!res.ok || !data.entry) {
        setSummaryMsg(data.error || "Vazgeçilemedi.");
        setSummaryBusy(false);
        return;
      }
      applyEntry(data.entry);
      setSummaryMsg("Öneri silindi. Yazın olduğu gibi duruyor.");
    } catch {
      setSummaryMsg("Bağlantı hatası.");
    } finally {
      setSummaryBusy(false);
    }
  }

  const statusLabel =
    saveState === "saving"
      ? "Kaydediliyor…"
      : saveState === "saved"
        ? "Kaydedildi"
        : saveState === "failed"
          ? "Kaydedilemedi"
          : saveState === "conflict"
            ? "Çakışma"
            : " ";

  const pendingSuggestion =
    suggestion &&
    (suggestion.status === "PENDING" || suggestion.status === "STALE")
      ? suggestion
      : null;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 text-sm" style={{ color: "var(--muted)" }}>
        <span aria-live="polite">{statusLabel}</span>
      </div>

      <label className="block" htmlFor="journal-body">
        <span className="sr-only">Günlük yazın</span>
        <textarea
          id="journal-body"
          value={body}
          onChange={(e) => {
            setBody(e.target.value);
            setSaveState("idle");
          }}
          rows={10}
          maxLength={8000}
          className="w-full rounded-2xl border p-4 text-base leading-relaxed"
          style={{ borderColor: "var(--line)", background: "white", minHeight: 220 }}
          placeholder="Düşüncelerini buraya yaz…"
        />
      </label>

      {features.transcriptionAvailable ? (
        <VoiceRecorder
          entryId={entryId}
          expectedRevision={revision}
          onApplied={async (payload, transcript) => {
            const local = payload as {
              __applyTranscriptLocally?: boolean;
              transcript?: string;
              mode?: "append" | "replace";
              skipTranscriptRow?: boolean;
            };
            if (local.__applyTranscriptLocally && local.transcript) {
              await applyReviewedTranscript(
                local.transcript,
                local.mode || "append",
                local.skipTranscriptRow === true,
              );
              return;
            }
            if (payload && typeof payload === "object" && "revision" in (payload as object)) {
              applyEntry(payload as ChildEntryView);
            } else {
              await applyReviewedTranscript(transcript, "append");
            }
          }}
        />
      ) : (
        <p className="text-sm" style={{ color: "var(--muted)" }}>
          Sesle anlatım şu an yapılandırılmamış. Yazarak devam edebilirsin.
          {getAiFeatureStatusClientHint()}
        </p>
      )}

      <div className="space-y-2">
        {features.summarizationAvailable ? (
          <button
            type="button"
            disabled={summaryBusy || !body.trim()}
            onClick={() => void requestSummary()}
            className="inline-flex min-h-12 w-full items-center justify-center rounded-2xl px-4 text-base font-semibold disabled:opacity-50"
            style={{ background: "var(--accent-soft)", color: "var(--ink)" }}
          >
            {summaryBusy ? "Özet hazırlanıyor…" : "Yazımı toparla"}
          </button>
        ) : (
          <p className="text-sm" style={{ color: "var(--muted)" }}>
            Özet önerisi şu an yapılandırılmamış.
          </p>
        )}
        {summaryMsg ? (
          <p className="text-sm" style={{ color: "var(--muted)" }} role="status">
            {summaryMsg}
          </p>
        ) : null}
      </div>

      {pendingSuggestion ? (
        <section
          className="space-y-3 rounded-2xl border p-4"
          style={{ borderColor: "var(--line)", background: "rgba(255,255,255,0.7)" }}
        >
          <h3 className="font-semibold">Önerilen özet</h3>
          {pendingSuggestion.isStale || pendingSuggestion.status === "STALE" ? (
            <p className="text-sm font-semibold" style={{ color: "var(--warn)" }}>
              Bu öneri eski metne ait. Kabul etmeden önce yeniden “Yazımı toparla” diyebilirsin.
            </p>
          ) : null}
          <textarea
            value={suggestionDraft}
            onChange={(e) => setSuggestionDraft(e.target.value)}
            rows={6}
            maxLength={8000}
            className="w-full rounded-2xl border p-3 text-base"
            style={{ borderColor: "var(--line)", background: "white" }}
            aria-label="Önerilen özet"
          />
          <div className="flex flex-col gap-2">
            <button
              type="button"
              disabled={summaryBusy || pendingSuggestion.isStale}
              onClick={() => void acceptSuggestion()}
              className="inline-flex min-h-12 items-center justify-center rounded-2xl px-4 font-semibold disabled:opacity-50"
              style={{ background: "var(--accent)", color: "white" }}
            >
              Özeti kabul et
            </button>
            <button
              type="button"
              disabled={summaryBusy}
              onClick={() => void discardSuggestion()}
              className="inline-flex min-h-12 items-center justify-center rounded-2xl px-4 font-semibold"
              style={{ border: "1px solid var(--line)" }}
            >
              Öneriyi sil
            </button>
            <button
              type="button"
              disabled={summaryBusy}
              onClick={() => void requestSummary()}
              className="inline-flex min-h-12 items-center justify-center rounded-2xl px-4 font-semibold"
              style={{ background: "var(--accent-soft)" }}
            >
              Yeniden öner
            </button>
          </div>
        </section>
      ) : null}

      {(originalBody.trim() || acceptedSummary.trim()) && (
        <div className="space-y-2">
          <button
            type="button"
            onClick={() => setShowOriginal((v) => !v)}
            className="text-sm font-semibold underline"
          >
            {showOriginal ? "Orijinali gizle" : "Orijinal yazımı göster"}
          </button>
          {showOriginal ? (
            <p
              className="whitespace-pre-wrap rounded-2xl border p-3 text-sm"
              style={{ borderColor: "var(--line)", color: "var(--muted)" }}
            >
              {originalBody.trim() || "(Orijinal metin yok)"}
            </p>
          ) : null}
        </div>
      )}

      {error ? (
        <p className="text-sm" style={{ color: "var(--danger)" }} role="alert">
          {error}
        </p>
      ) : null}

      <button
        type="button"
        onClick={() => {
          if (timerRef.current) clearTimeout(timerRef.current);
          void save({ markSaved: true });
        }}
        className="inline-flex min-h-12 w-full items-center justify-center rounded-2xl px-4 text-base font-semibold"
        style={{ background: "var(--accent-soft)", color: "var(--ink)" }}
      >
        Kaydet (bende kalsın)
      </button>

      {body.trim() ? (
        <div className="space-y-2">
          {features.planExtractAvailable ? (
            <Link
              href={`/cocuk/gunluk/${entryId}/plan-oneri`}
              onClick={() => {
                if (timerRef.current) clearTimeout(timerRef.current);
                void save({ markSaved: true });
              }}
              className="inline-flex min-h-12 w-full items-center justify-center rounded-2xl px-4 text-base font-semibold"
              style={{ border: "1px solid var(--line)", color: "var(--ink)" }}
            >
              Planıma neler ekleyebilirim?
            </Link>
          ) : (
            <p className="text-sm" style={{ color: "var(--muted)" }}>
              Plan önerisi şu an yapılandırılmamış. Planını elle ekleyebilirsin.
            </p>
          )}
        </div>
      ) : null}
    </div>
  );
}
