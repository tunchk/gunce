"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  ExtractBatchView,
  ExtractCandidateView,
} from "@/lib/plan-extract";

type OpenCommitment = {
  id: string;
  type: string;
  title: string;
  dueDate: string | null;
  eventDate: string | null;
};

type DraftCard = {
  candidateId: string;
  selected: boolean;
  title: string;
  subject: string;
  confirmedDate: string;
  dateUnknown: boolean;
  plannedDate: string;
  leaveUnscheduled: boolean;
  estimatedMinutes: string;
  relatedMode: "none" | "candidate" | "existing";
  relatedCandidateId: string;
  relatedCommitmentId: string;
  duplicateDecision: "" | "skip" | "add_separate";
  showExcerpt: boolean;
};

function typeLabel(type: string) {
  switch (type) {
    case "HOMEWORK":
      return "Ödev";
    case "EXAM":
      return "Sınav";
    case "COURSE":
      return "Kurs / etkinlik";
    case "STUDY_STEP":
      return "Çalışma adımı";
    default:
      return type;
  }
}

function mentionLabel(kind: string) {
  return kind === "PREPARATION" ? "Hazırlık önerisi" : "Metinde geçiyor";
}

function toDraft(c: ExtractCandidateView): DraftCard {
  const applied = c.status === "APPLIED" || c.status === "SKIPPED";
  return {
    candidateId: c.id,
    selected: false,
    title: c.title,
    subject: c.subject,
    confirmedDate: c.proposedDate ?? "",
    dateUnknown: c.type === "HOMEWORK" && !c.proposedDate,
    plannedDate: c.proposedDate ?? "",
    leaveUnscheduled: c.type === "STUDY_STEP" && !c.proposedDate,
    estimatedMinutes:
      c.estimatedMinutes != null ? String(c.estimatedMinutes) : "",
    relatedMode:
      c.type === "STUDY_STEP" && c.relatedCandidateOrdinal != null
        ? "candidate"
        : "none",
    relatedCandidateId: "",
    relatedCommitmentId: "",
    duplicateDecision: "",
    showExcerpt: false,
  };
}

export function PlanExtractReview({
  entryId,
  extractAvailable,
  initialBatch,
  initialCommitments,
}: {
  entryId: string;
  extractAvailable: boolean;
  initialBatch: ExtractBatchView | null;
  initialCommitments: OpenCommitment[];
}) {
  const [batch, setBatch] = useState<ExtractBatchView | null>(initialBatch);
  const [commitments, setCommitments] = useState(initialCommitments);
  const [drafts, setDrafts] = useState<DraftCard[]>(
    () => initialBatch?.candidates.map(toDraft) ?? [],
  );
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | undefined>();
  const [error, setError] = useState<string | undefined>();
  const [confirmNotice, setConfirmNotice] = useState(false);
  const [done, setDone] = useState(false);
  const [applyRequestId] = useState(
    () =>
      (typeof crypto !== "undefined" && crypto.randomUUID
        ? crypto.randomUUID()
        : `apply_${Date.now()}`),
  );

  const candidateByOrdinal = useMemo(() => {
    const map = new Map<number, ExtractCandidateView>();
    batch?.candidates.forEach((c) => map.set(c.ordinal, c));
    return map;
  }, [batch]);

  useEffect(() => {
    if (!batch) return;
    setDrafts((prev) => {
      const prevMap = new Map(prev.map((d) => [d.candidateId, d]));
      return batch.candidates.map((c) => {
        const existing = prevMap.get(c.id);
        if (existing) {
          // Resolve relatedCandidateId from ordinal once
          if (
            existing.relatedMode === "candidate" &&
            !existing.relatedCandidateId &&
            c.relatedCandidateOrdinal != null
          ) {
            const related = candidateByOrdinal.get(c.relatedCandidateOrdinal);
            if (related) {
              return { ...existing, relatedCandidateId: related.id };
            }
          }
          return existing;
        }
        const d = toDraft(c);
        if (c.relatedCandidateOrdinal != null) {
          const related = candidateByOrdinal.get(c.relatedCandidateOrdinal);
          if (related) d.relatedCandidateId = related.id;
        }
        return d;
      });
    });
  }, [batch, candidateByOrdinal]);

  const refresh = useCallback(async () => {
    const res = await fetch(`/api/child/journal/${entryId}/plan-extract`, {
      cache: "no-store",
    });
    const data = (await res.json()) as {
      batch?: ExtractBatchView | null;
      openCommitments?: OpenCommitment[];
      error?: string;
    };
    if (!res.ok) {
      setError(data.error || "Yüklenemedi.");
      return;
    }
    setBatch(data.batch ?? null);
    setCommitments(data.openCommitments ?? []);
    if (data.batch) {
      setDrafts(data.batch.candidates.map(toDraft));
    }
  }, [entryId]);

  async function generate() {
    setBusy(true);
    setError(undefined);
    setMsg(undefined);
    setDone(false);
    try {
      // Save pending journal edits first
      const entryRes = await fetch(`/api/child/journal/${entryId}`, {
        cache: "no-store",
      });
      const entryData = (await entryRes.json()) as {
        entry?: { revision: number; body: string };
        error?: string;
      };
      if (!entryRes.ok || !entryData.entry) {
        setError(entryData.error || "Günlük kaydı okunamadı.");
        setBusy(false);
        return;
      }

      const saveRes = await fetch(`/api/child/journal/${entryId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          op: "update_body",
          body: entryData.entry.body,
          expectedRevision: entryData.entry.revision,
          markSaved: true,
        }),
      });
      const saveData = (await saveRes.json()) as {
        entry?: { revision: number };
        error?: string;
      };
      if (!saveRes.ok || !saveData.entry) {
        setError(saveData.error || "Önce yazını kaydet.");
        setBusy(false);
        return;
      }

      const requestId =
        typeof crypto !== "undefined" && crypto.randomUUID
          ? crypto.randomUUID()
          : `ext_${Date.now()}`;

      const res = await fetch(`/api/child/journal/${entryId}/plan-extract`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          expectedRevision: saveData.entry.revision,
          requestId,
        }),
      });
      const data = (await res.json()) as {
        batch?: ExtractBatchView;
        error?: string;
      };
      if (!res.ok || !data.batch) {
        setError(data.error || "Plan önerisi alınamadı.");
        setBusy(false);
        return;
      }
      setBatch(data.batch);
      setDrafts(data.batch.candidates.map(toDraft));
      setMsg(
        data.batch.candidates.length === 0
          ? "Bu yazıdan eklenecek bir plan adayı çıkmadı. Elle plan ekleyebilirsin."
          : "Öneriler hazır. İstediklerini seç, düzenle ve planına ekle.",
      );
      await refresh();
    } catch {
      setError("Bağlantı hatası.");
    } finally {
      setBusy(false);
    }
  }

  function updateDraft(id: string, patch: Partial<DraftCard>) {
    setDrafts((rows) =>
      rows.map((r) => (r.candidateId === id ? { ...r, ...patch } : r)),
    );
  }

  async function applySelected() {
    if (!batch || batch.isStale) {
      setError("Öneriler güncel değil. Yeniden iste.");
      return;
    }
    if (!confirmNotice) {
      setError("Devam etmeden önce veli görünürlüğü bilgisini onayla.");
      return;
    }
    const selectedDrafts = drafts.filter((d) => d.selected);
    if (selectedDrafts.length === 0) {
      setError("En az bir öneri seçmelisin.");
      return;
    }

    setBusy(true);
    setError(undefined);
    try {
      const selections = selectedDrafts.map((d) => {
        const cand = batch.candidates.find((c) => c.id === d.candidateId)!;
        const base = {
          candidateId: d.candidateId,
          selected: true as const,
          title: d.title,
          subject: d.subject,
          duplicateDecision: d.duplicateDecision || null,
        };
        if (cand.type === "STUDY_STEP") {
          return {
            ...base,
            plannedDate: d.leaveUnscheduled ? null : d.plannedDate || null,
            estimatedMinutes: d.estimatedMinutes
              ? Number(d.estimatedMinutes)
              : null,
            relatedCandidateId:
              d.relatedMode === "candidate" ? d.relatedCandidateId || null : null,
            relatedCommitmentId:
              d.relatedMode === "existing" ? d.relatedCommitmentId || null : null,
          };
        }
        return {
          ...base,
          confirmedDate: d.dateUnknown ? null : d.confirmedDate || null,
          dateUnknown: d.dateUnknown,
        };
      });

      const res = await fetch(
        `/api/child/journal/${entryId}/plan-extract/apply`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            batchId: batch.id,
            applyRequestId,
            expectedSourceRevision: batch.sourceRevision,
            selections,
          }),
        },
      );
      const data = (await res.json()) as {
        batch?: ExtractBatchView;
        error?: string;
        code?: string;
        details?: {
          duplicates?: Array<{ candidateId: string; title: string }>;
        };
      };

      if (res.status === 409 && data.code === "DUPLICATE_REVIEW") {
        const ids = new Set(
          (data.details?.duplicates ?? []).map((d) => d.candidateId),
        );
        setDrafts((rows) =>
          rows.map((r) =>
            ids.has(r.candidateId) && !r.duplicateDecision
              ? { ...r, duplicateDecision: "" }
              : r,
          ),
        );
        setError(
          "Benzer plan öğeleri bulundu. Her biri için “Atla” veya “Ayrı ekle” seç.",
        );
        setBusy(false);
        return;
      }

      if (!res.ok || !data.batch) {
        setError(data.error || "Planına eklenemedi.");
        setBusy(false);
        return;
      }

      setBatch(data.batch);
      setDone(true);
      setMsg("Seçtiklerin planına eklendi.");
    } catch {
      setError("Bağlantı hatası.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <p className="text-sm" style={{ color: "var(--muted)" }}>
        Öneriler günlük yazından çıkarılır; plana yalnızca sen seçtiklerin eklenir.
        {batch ? (
          <>
            {" "}
            Kaynak sürüm: {batch.sourceRevision}
            {batch.isStale ? " (eski — yeniden iste)" : ""}
          </>
        ) : null}
      </p>

      {extractAvailable ? (
        <button
          type="button"
          disabled={busy}
          onClick={() => void generate()}
          className="inline-flex min-h-12 w-full items-center justify-center rounded-2xl px-4 font-semibold disabled:opacity-50"
          style={{ background: "var(--accent-soft)", color: "var(--ink)" }}
        >
          {busy
            ? "Hazırlanıyor…"
            : batch
              ? "Yeniden öner"
              : "Plan önerilerini hazırla"}
        </button>
      ) : (
        <p className="text-sm" style={{ color: "var(--muted)" }}>
          Plan önerisi şu an yapılandırılmamış. Planını elle ekleyebilirsin.
        </p>
      )}

      {msg ? (
        <p className="text-sm" role="status" style={{ color: "var(--muted)" }}>
          {msg}
        </p>
      ) : null}
      {error ? (
        <p className="text-sm" role="alert" style={{ color: "var(--danger)" }}>
          {error}
        </p>
      ) : null}

      {done ? (
        <div className="space-y-3 rounded-2xl border p-4" style={{ borderColor: "var(--line)" }}>
          <p className="font-semibold">Planına eklendi.</p>
          <Link
            href="/cocuk/haftam"
            className="inline-flex min-h-12 items-center justify-center rounded-2xl px-4 font-semibold"
            style={{ background: "var(--accent)", color: "white" }}
          >
            Planımı gör
          </Link>
        </div>
      ) : null}

      {batch && !done ? (
        <div className="space-y-3">
          {batch.candidates.length === 0 ? (
            <p className="text-sm" style={{ color: "var(--muted)" }}>
              Aday yok. Mutlu anılar görev olmaz.
            </p>
          ) : (
            batch.candidates.map((cand) => {
              const draft = drafts.find((d) => d.candidateId === cand.id);
              if (!draft) return null;
              const applied = cand.status === "APPLIED";
              const skipped = cand.status === "SKIPPED";
              return (
                <section
                  key={cand.id}
                  data-testid={`plan-extract-candidate-${cand.type}`}
                  className="space-y-3 rounded-2xl border p-4"
                  style={{
                    borderColor: "var(--line)",
                    background: applied || skipped ? "rgba(0,0,0,0.03)" : "white",
                    opacity: applied || skipped ? 0.75 : 1,
                  }}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold">
                        {typeLabel(cand.type)} · {mentionLabel(cand.mentionKind)}
                      </p>
                      {applied ? (
                        <p className="text-sm" style={{ color: "var(--muted)" }}>
                          Planına eklendi
                        </p>
                      ) : null}
                      {skipped ? (
                        <p className="text-sm" style={{ color: "var(--muted)" }}>
                          Atlandı (benzer öğe)
                        </p>
                      ) : null}
                    </div>
                    {!applied && !skipped ? (
                      <label className="inline-flex min-h-12 items-center gap-2 font-semibold">
                        <input
                          type="checkbox"
                          checked={draft.selected}
                          onChange={(e) =>
                            updateDraft(cand.id, { selected: e.target.checked })
                          }
                        />
                        Seç
                      </label>
                    ) : null}
                  </div>

                  <label className="block text-sm font-semibold">
                    Başlık
                    <input
                      value={draft.title}
                      disabled={applied || skipped || !draft.selected}
                      onChange={(e) =>
                        updateDraft(cand.id, { title: e.target.value })
                      }
                      className="mt-1 w-full rounded-xl border px-3 py-3"
                      style={{ borderColor: "var(--line)" }}
                    />
                  </label>

                  <button
                    type="button"
                    className="text-sm font-semibold underline"
                    onClick={() =>
                      updateDraft(cand.id, { showExcerpt: !draft.showExcerpt })
                    }
                  >
                    Bunu nereden çıkardık?
                  </button>
                  {draft.showExcerpt ? (
                    <p
                      className="rounded-xl border p-3 text-sm"
                      style={{ borderColor: "var(--line)", color: "var(--muted)" }}
                    >
                      “{cand.sourceExcerpt}”
                    </p>
                  ) : null}

                  {cand.datePhrase ? (
                    <p className="text-sm" style={{ color: "var(--muted)" }}>
                      Metindeki tarih ifadesi: “{cand.datePhrase}”
                      {cand.dateUncertain ? " (belirsiz)" : ""}
                    </p>
                  ) : null}

                  {cand.type === "STUDY_STEP" ? (
                    <div className="space-y-2">
                      <label className="inline-flex items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          disabled={!draft.selected || applied}
                          checked={draft.leaveUnscheduled}
                          onChange={(e) =>
                            updateDraft(cand.id, {
                              leaveUnscheduled: e.target.checked,
                            })
                          }
                        />
                        Tarihsiz bırak
                      </label>
                      {!draft.leaveUnscheduled ? (
                        <label className="block text-sm font-semibold">
                          Planlanan gün (onayla)
                          <input
                            type="date"
                            disabled={!draft.selected || applied}
                            value={draft.plannedDate}
                            onChange={(e) =>
                              updateDraft(cand.id, {
                                plannedDate: e.target.value,
                              })
                            }
                            className="mt-1 w-full rounded-xl border px-3 py-3"
                            style={{ borderColor: "var(--line)" }}
                          />
                        </label>
                      ) : null}
                      <label className="block text-sm font-semibold">
                        Tahmini dakika (isteğe bağlı)
                        <input
                          type="number"
                          min={1}
                          max={1440}
                          disabled={!draft.selected || applied}
                          value={draft.estimatedMinutes}
                          onChange={(e) =>
                            updateDraft(cand.id, {
                              estimatedMinutes: e.target.value,
                            })
                          }
                          className="mt-1 w-full rounded-xl border px-3 py-3"
                          style={{ borderColor: "var(--line)" }}
                        />
                      </label>
                      <label className="block text-sm font-semibold">
                        Bağlantı
                        <select
                          disabled={!draft.selected || applied}
                          value={draft.relatedMode}
                          onChange={(e) =>
                            updateDraft(cand.id, {
                              relatedMode: e.target.value as DraftCard["relatedMode"],
                            })
                          }
                          className="mt-1 w-full rounded-xl border px-3 py-3"
                          style={{ borderColor: "var(--line)" }}
                        >
                          <option value="none">Tek başına</option>
                          <option value="candidate">Bu listedeki bir işe bağla</option>
                          <option value="existing">Mevcut plana bağla</option>
                        </select>
                      </label>
                      {draft.relatedMode === "candidate" ? (
                        <select
                          disabled={!draft.selected || applied}
                          value={draft.relatedCandidateId}
                          onChange={(e) =>
                            updateDraft(cand.id, {
                              relatedCandidateId: e.target.value,
                            })
                          }
                          className="w-full rounded-xl border px-3 py-3"
                          style={{ borderColor: "var(--line)" }}
                        >
                          <option value="">Seç…</option>
                          {batch.candidates
                            .filter(
                              (c) =>
                                c.id !== cand.id && c.type !== "STUDY_STEP",
                            )
                            .map((c) => (
                              <option key={c.id} value={c.id}>
                                {c.title}
                              </option>
                            ))}
                        </select>
                      ) : null}
                      {draft.relatedMode === "existing" ? (
                        <select
                          disabled={!draft.selected || applied}
                          value={draft.relatedCommitmentId}
                          onChange={(e) =>
                            updateDraft(cand.id, {
                              relatedCommitmentId: e.target.value,
                            })
                          }
                          className="w-full rounded-xl border px-3 py-3"
                          style={{ borderColor: "var(--line)" }}
                        >
                          <option value="">Seç…</option>
                          {commitments
                            .filter((c) => c.type === "HOMEWORK" || c.type === "EXAM")
                            .map((c) => (
                              <option key={c.id} value={c.id}>
                                {c.title}
                              </option>
                            ))}
                        </select>
                      ) : null}
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {cand.type === "HOMEWORK" ? (
                        <label className="inline-flex items-center gap-2 text-sm">
                          <input
                            type="checkbox"
                            disabled={!draft.selected || applied}
                            checked={draft.dateUnknown}
                            onChange={(e) =>
                              updateDraft(cand.id, {
                                dateUnknown: e.target.checked,
                              })
                            }
                          />
                          Teslim tarihi belli değil
                        </label>
                      ) : null}
                      {!draft.dateUnknown ? (
                        <label className="block text-sm font-semibold">
                          {cand.type === "HOMEWORK"
                            ? "Teslim tarihi (onayla)"
                            : "Etkinlik tarihi (onayla)"}
                          <input
                            type="date"
                            disabled={!draft.selected || applied}
                            value={draft.confirmedDate}
                            onChange={(e) =>
                              updateDraft(cand.id, {
                                confirmedDate: e.target.value,
                              })
                            }
                            className="mt-1 w-full rounded-xl border px-3 py-3"
                            style={{ borderColor: "var(--line)" }}
                          />
                        </label>
                      ) : null}
                    </div>
                  )}

                  {cand.likelyDuplicates.length > 0 && draft.selected ? (
                    <div
                      className="space-y-2 rounded-xl border p-3 text-sm"
                      style={{ borderColor: "var(--warn)" }}
                    >
                      <p className="font-semibold">Benzer plan öğesi var:</p>
                      <ul className="list-disc pl-5">
                        {cand.likelyDuplicates.map((d) => (
                          <li key={d.id}>{d.title}</li>
                        ))}
                      </ul>
                      <select
                        value={draft.duplicateDecision}
                        onChange={(e) =>
                          updateDraft(cand.id, {
                            duplicateDecision: e.target
                              .value as DraftCard["duplicateDecision"],
                          })
                        }
                        className="w-full rounded-xl border px-3 py-3"
                        style={{ borderColor: "var(--line)" }}
                      >
                        <option value="">Seç: atla veya ayrı ekle</option>
                        <option value="skip">Atla</option>
                        <option value="add_separate">Ayrı öğe olarak ekle</option>
                      </select>
                    </div>
                  ) : null}

                  {draft.selected ? (
                    <div
                      className="rounded-xl border p-3 text-sm"
                      style={{ borderColor: "var(--line)", background: "var(--accent-soft)" }}
                    >
                      <p className="font-semibold">Velinin göreceği alanlar</p>
                      <p>
                        {typeLabel(cand.type)}: {draft.title || "—"}
                      </p>
                      {cand.type === "STUDY_STEP" ? (
                        <p>
                          Planlanan gün:{" "}
                          {draft.leaveUnscheduled
                            ? "tarihsiz"
                            : draft.plannedDate || "—"}
                        </p>
                      ) : (
                        <p>
                          Tarih:{" "}
                          {draft.dateUnknown
                            ? "belli değil"
                            : draft.confirmedDate || "—"}
                        </p>
                      )}
                    </div>
                  ) : null}
                </section>
              );
            })
          )}

          {batch.candidates.some((c) => c.status === "PENDING") ? (
            <>
              <label className="flex items-start gap-3 text-sm leading-relaxed">
                <input
                  type="checkbox"
                  className="mt-1"
                  checked={confirmNotice}
                  onChange={(e) => setConfirmNotice(e.target.checked)}
                />
                <span>
                  Planına eklediklerini velin de görebilir. Günlük yazın
                  paylaşılmaz.
                </span>
              </label>
              <button
                type="button"
                disabled={busy || batch.isStale}
                onClick={() => void applySelected()}
                className="inline-flex min-h-12 w-full items-center justify-center rounded-2xl px-4 font-semibold disabled:opacity-50"
                style={{ background: "var(--accent)", color: "white" }}
              >
                Seçtiklerimi planıma ekle
              </button>
            </>
          ) : null}
        </div>
      ) : null}

      <Link
        href={`/cocuk/gunluk/${entryId}`}
        className="inline-flex min-h-12 items-center font-semibold underline"
      >
        Günlüğe dön
      </Link>
    </div>
  );
}
