"use client";

import { useCallback, useEffect, useState } from "react";
import type { GuardianAiView } from "@/lib/journal-ai";
import { Button } from "@/components/ui";

type EntryPayload = {
  entryId: string;
  body: string;
  updatedAt: string;
  ai: GuardianAiView;
};

function statusCopy(ai: GuardianAiView, kind: "summary" | "guidance") {
  if (ai.status === "READY") return null;
  if (ai.status === "UNAVAILABLE") {
    return ai.reason || "Yapay zekâ şu an yapılandırılmamış.";
  }
  if (ai.status === "FAILED") {
    return (
      ai.reason ||
      (kind === "summary"
        ? "Özet hazırlanamadı. Kaydedilen anlatım yukarıda duruyor."
        : "Yaklaşım önerisi hazırlanamadı.")
    );
  }
  if (ai.status === "PROCESSING") {
    return kind === "summary"
      ? "Özet işleniyor… Kaydedilen anlatım yukarıda duruyor."
      : "Yaklaşım önerisi işleniyor…";
  }
  if (ai.status === "QUEUED") {
    return kind === "summary"
      ? "Özet sırada bekliyor… Kaydedilen anlatım yukarıda duruyor."
      : "Yaklaşım önerisi sırada bekliyor…";
  }
  if (ai.status === "STALE") {
    return kind === "summary"
      ? "Metin güncellendi; yeni özet bekleniyor."
      : "Metin güncellendi; yeni yaklaşım bekleniyor.";
  }
  return kind === "summary"
    ? "Özet henüz yok. Kaydedilen anlatım yukarıda duruyor."
    : "Yaklaşım önerisi henüz yok.";
}

export function ParentJournalAiPanels({
  entryId,
  initialAi,
}: {
  entryId: string;
  initialAi: GuardianAiView;
}) {
  const [ai, setAi] = useState(initialAi);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`/api/parent/journal/${entryId}`, {
        cache: "no-store",
      });
      if (!res.ok) return;
      const data = (await res.json()) as { entry?: EntryPayload };
      if (data.entry?.ai) setAi(data.entry.ai);
    } catch {
      // ignore transient poll errors
    }
  }, [entryId]);

  useEffect(() => {
    const pending =
      ai.status === "QUEUED" ||
      ai.status === "PROCESSING" ||
      ai.status === "STALE";
    if (!pending) return;
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, 4_000);
    function onVis() {
      if (document.visibilityState === "visible") void refresh();
    }
    document.addEventListener("visibilitychange", onVis);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [ai.status, refresh]);

  async function retry() {
    setBusy(true);
    setError(undefined);
    try {
      const res = await fetch(`/api/parent/journal/${entryId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ op: "retry_ai" }),
      });
      const data = (await res.json()) as { entry?: EntryPayload; error?: string };
      if (!res.ok || !data.entry) {
        setError(data.error || "Yeniden denenemedi.");
        return;
      }
      setAi(data.entry.ai);
    } catch {
      setError("Bağlantı hatası.");
    } finally {
      setBusy(false);
    }
  }

  const summaryPending = statusCopy(ai, "summary");
  const guidancePending = statusCopy(ai, "guidance");
  const showRetry =
    ai.canRetry &&
    (ai.status === "FAILED" || ai.status === "STALE" || ai.status === "UNAVAILABLE");

  return (
    <div className="space-y-4">
      <section
        className="rounded-3xl border p-4 sm:p-5"
        style={{ borderColor: "var(--line)", background: "var(--surface)" }}
      >
        <h2 className="text-lg font-semibold">AI özeti</h2>
        {ai.status === "READY" && ai.summaryText ? (
          <>
            <p className="mt-2 text-xs font-semibold" style={{ color: "var(--muted)" }}>
              {ai.label}
            </p>
            <p className="mt-3 whitespace-pre-wrap text-base leading-relaxed">
              {ai.summaryText}
            </p>
          </>
        ) : (
          <p className="mt-3 text-sm" style={{ color: "var(--muted)" }} role="status">
            {summaryPending}
          </p>
        )}
      </section>

      <section
        className="rounded-3xl border p-4 sm:p-5"
        style={{ borderColor: "var(--line)", background: "var(--surface)" }}
      >
        <h2 className="text-lg font-semibold">Velilere yaklaşım önerisi</h2>
        <p className="mt-1 text-xs font-semibold" style={{ color: "var(--muted)" }}>
          Yalnızca veliler görür · AI üretimi · Çocuğun kendi sözü değildir
        </p>
        {ai.status === "READY" &&
        (ai.conversationOpener || ai.supportAction) ? (
          <ul className="mt-3 space-y-3 text-base leading-relaxed">
            {ai.conversationOpener ? (
              <li>
                <span className="font-semibold">Konuşma açıcı: </span>
                {ai.conversationOpener}
              </li>
            ) : null}
            {ai.supportAction ? (
              <li>
                <span className="font-semibold">İsteğe bağlı destek: </span>
                {ai.supportAction}
              </li>
            ) : null}
          </ul>
        ) : (
          <p className="mt-3 text-sm" style={{ color: "var(--muted)" }} role="status">
            {guidancePending}
          </p>
        )}
      </section>

      {showRetry ? (
        <div className="space-y-2">
          <Button type="button" variant="secondary" disabled={busy} onClick={() => void retry()}>
            {busy ? "Yeniden deneniyor…" : "Özeti yeniden dene"}
          </Button>
          {error ? (
            <p className="text-sm" style={{ color: "var(--danger)" }} role="alert">
              {error}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
