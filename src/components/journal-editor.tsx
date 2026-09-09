"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ChildEntryView } from "@/lib/journal";

type SaveState = "idle" | "saving" | "saved" | "failed" | "conflict";

export function JournalEditor({
  entryId,
  initial,
}: {
  entryId: string;
  initial: ChildEntryView;
}) {
  const [body, setBody] = useState(initial.body);
  const [revision, setRevision] = useState(initial.revision);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [error, setError] = useState<string | undefined>();
  const latestRef = useRef({ body: initial.body, revision: initial.revision });
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const seqRef = useRef(0);

  useEffect(() => {
    latestRef.current = { body, revision };
  }, [body, revision]);

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
          code?: string;
        };

        if (seq !== seqRef.current) {
          return false;
        }

        if (res.status === 401) {
          setSaveState("failed");
          setError("Oturumun sona erdi. Kaydedilmeyen metin bu cihazda duruyor; yeniden giriş yapıp kopyalayabilirsin.");
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

        setRevision(data.entry.revision);
        latestRef.current.revision = data.entry.revision;
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
    [entryId],
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

  async function onManualSave() {
    if (timerRef.current) clearTimeout(timerRef.current);
    await save({ markSaved: true });
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

  return (
    <div className="space-y-3">
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
          rows={12}
          maxLength={8000}
          className="w-full rounded-2xl border p-4 text-base leading-relaxed"
          style={{ borderColor: "var(--line)", background: "white", minHeight: 240 }}
          placeholder="Düşüncelerini buraya yaz…"
        />
      </label>
      {error ? (
        <p className="text-sm" style={{ color: "var(--danger)" }} role="alert">
          {error}
        </p>
      ) : null}
      <button
        type="button"
        onClick={() => void onManualSave()}
        className="inline-flex min-h-12 w-full items-center justify-center rounded-2xl px-4 text-base font-semibold"
        style={{ background: "var(--accent-soft)", color: "var(--ink)" }}
      >
        Kaydet (bende kalsın)
      </button>
    </div>
  );
}
