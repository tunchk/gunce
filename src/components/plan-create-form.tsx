"use client";

import { useRouter } from "next/navigation";
import { useEffect, useId, useState } from "react";
import { Button, FieldError, TextField } from "@/components/ui";
import type { CommitmentView } from "@/lib/plan";
import { commitmentTypeLabel, newClientRequestId } from "@/lib/plan-ui";

type Kind = "HOMEWORK" | "EXAM" | "COURSE" | "STUDY_STEP";

export function PlanCreateForm({
  prefillRelatedCommitmentId,
  offerPrepAfter,
}: {
  prefillRelatedCommitmentId?: string;
  offerPrepAfter?: { commitmentId: string; title: string } | null;
}) {
  const router = useRouter();
  const formId = useId();
  const [kind, setKind] = useState<Kind | null>(
    prefillRelatedCommitmentId ? "STUDY_STEP" : null,
  );
  const [title, setTitle] = useState("");
  const [subject, setSubject] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [dateUnknown, setDateUnknown] = useState(false);
  const [eventDate, setEventDate] = useState("");
  const [eventTimeLocal, setEventTimeLocal] = useState("");
  const [plannedDate, setPlannedDate] = useState("");
  const [estimatedMinutes, setEstimatedMinutes] = useState("");
  const [relatedCommitmentId, setRelatedCommitmentId] = useState(
    prefillRelatedCommitmentId || "",
  );
  const [linkables, setLinkables] = useState<CommitmentView[]>([]);
  const [error, setError] = useState<string>();
  const [pending, setPending] = useState(false);
  const [requestId] = useState(() => newClientRequestId());
  const [createdOffer, setCreatedOffer] = useState<{
    commitmentId: string;
    title: string;
  } | null>(offerPrepAfter || null);

  useEffect(() => {
    if (kind !== "STUDY_STEP") return;
    void fetch("/api/child/plan?linkable=1")
      .then((r) => r.json())
      .then((data: { commitments?: CommitmentView[] }) => {
        setLinkables(data.commitments || []);
      })
      .catch(() => setLinkables([]));
  }, [kind]);

  async function submit(allowAfterDeadline = false) {
    if (!kind) return;
    setPending(true);
    setError(undefined);
    try {
      if (kind === "STUDY_STEP") {
        const res = await fetch("/api/child/plan", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            kind: "study_step",
            title,
            subject,
            plannedDate: plannedDate || null,
            estimatedMinutes: estimatedMinutes ? Number(estimatedMinutes) : null,
            relatedCommitmentId: relatedCommitmentId || null,
            allowAfterDeadline,
            clientRequestId: requestId,
          }),
        });
        const data = (await res.json()) as {
          error?: string;
          code?: string;
          studyStep?: { id: string };
        };
        if (res.status === 409 && data.code === "DEADLINE_WARNING" && !allowAfterDeadline) {
          const ok = window.confirm(
            `${data.error || "Planlanan gün, bağlı işin tarihinden sonra."} Yine de kaydetmek istiyor musun?`,
          );
          if (ok) {
            await submit(true);
            return;
          }
          setPending(false);
          return;
        }
        if (!res.ok) {
          setError(data.error || "Kaydedilemedi.");
          setPending(false);
          return;
        }
        router.push("/cocuk/haftam");
        router.refresh();
        return;
      }

      const res = await fetch("/api/child/plan", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          kind: "commitment",
          type: kind,
          title,
          subject,
          dueDate: dueDate || null,
          dateUnknown: kind === "HOMEWORK" ? dateUnknown : false,
          eventDate: eventDate || null,
          eventTimeLocal: eventTimeLocal || null,
          clientRequestId: requestId,
        }),
      });
      const data = (await res.json()) as {
        error?: string;
        commitment?: { id: string; title: string };
      };
      if (!res.ok) {
        setError(data.error || "Kaydedilemedi.");
        setPending(false);
        return;
      }
      if (kind === "HOMEWORK" || kind === "EXAM") {
        setCreatedOffer({
          commitmentId: data.commitment!.id,
          title: data.commitment!.title,
        });
        setPending(false);
        setTitle("");
        setSubject("");
        return;
      }
      router.push("/cocuk/haftam");
      router.refresh();
    } catch {
      setError("Bağlantı hatası. Girdiğin bilgiler duruyor.");
      setPending(false);
    }
  }

  if (createdOffer) {
    return (
      <div className="space-y-4">
        <p className="text-base leading-relaxed">
          “{createdOffer.title}” kaydedildi. Hazırlık adımı eklemek ister misin?
        </p>
        <Button
          type="button"
          onClick={() => {
            const related = createdOffer.commitmentId;
            setCreatedOffer(null);
            setKind("STUDY_STEP");
            setRelatedCommitmentId(related);
            setTitle("");
            setSubject("");
            setPlannedDate("");
            setEstimatedMinutes("");
            setError(undefined);
          }}
        >
          Evet, adım ekle
        </Button>
        <Button
          type="button"
          variant="ghost"
          onClick={() => {
            router.push("/cocuk/haftam");
            router.refresh();
          }}
        >
          Şimdilik değil
        </Button>
      </div>
    );
  }

  if (!kind) {
    return (
      <div className="space-y-3">
        <p className="text-sm" style={{ color: "var(--muted)" }}>
          Önce ne eklemek istediğini seç.
        </p>
        {(
          [
            ["HOMEWORK", "Ödev"],
            ["EXAM", "Sınav"],
            ["COURSE", "Kurs / etkinlik"],
            ["STUDY_STEP", "Çalışma / hazırlık adımı"],
          ] as const
        ).map(([value, label]) => (
          <Button
            key={value}
            type="button"
            variant="secondary"
            onClick={() => setKind(value)}
          >
            {label}
          </Button>
        ))}
      </div>
    );
  }

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        void submit(false);
      }}
    >
      <p className="text-sm font-semibold">
        {kind === "STUDY_STEP" ? "Çalışma adımı" : commitmentTypeLabel(kind)}
      </p>
      <TextField
        label="Kısa başlık"
        name={`${formId}-title`}
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        required
        maxLength={200}
      />
      <TextField
        label="Ders / konu (isteğe bağlı)"
        name={`${formId}-subject`}
        value={subject}
        onChange={(e) => setSubject(e.target.value)}
        maxLength={80}
      />

      {kind === "HOMEWORK" ? (
        <>
          <label className="flex min-h-12 items-center gap-3 text-sm font-semibold">
            <input
              type="checkbox"
              checked={dateUnknown}
              onChange={(e) => setDateUnknown(e.target.checked)}
            />
            Tarih belli değil
          </label>
          {!dateUnknown ? (
            <TextField
              label="Teslim tarihi"
              name={`${formId}-due`}
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
            />
          ) : null}
        </>
      ) : null}

      {kind === "EXAM" || kind === "COURSE" ? (
        <>
          <TextField
            label="Tarih"
            name={`${formId}-event`}
            type="date"
            value={eventDate}
            onChange={(e) => setEventDate(e.target.value)}
            required
          />
          <TextField
            label="Saat (isteğe bağlı, HH:mm)"
            name={`${formId}-time`}
            type="time"
            value={eventTimeLocal}
            onChange={(e) => setEventTimeLocal(e.target.value)}
          />
        </>
      ) : null}

      {kind === "STUDY_STEP" ? (
        <>
          <TextField
            label="Planlanan gün (isteğe bağlı)"
            name={`${formId}-planned`}
            type="date"
            value={plannedDate}
            onChange={(e) => setPlannedDate(e.target.value)}
          />
          <TextField
            label="Tahmini süre (dk, isteğe bağlı)"
            name={`${formId}-mins`}
            type="number"
            min={1}
            max={1440}
            value={estimatedMinutes}
            onChange={(e) => setEstimatedMinutes(e.target.value)}
          />
          <label className="block text-sm font-semibold" htmlFor={`${formId}-related`}>
            Bağlı ödev / sınav (isteğe bağlı)
          </label>
          <select
            id={`${formId}-related`}
            className="min-h-12 w-full rounded-2xl border px-4"
            style={{ borderColor: "var(--line)", background: "white" }}
            value={relatedCommitmentId}
            onChange={(e) => setRelatedCommitmentId(e.target.value)}
          >
            <option value="">Bağlı değil</option>
            {linkables.map((c) => (
              <option key={c.id} value={c.id}>
                {commitmentTypeLabel(c.type)}: {c.title}
              </option>
            ))}
          </select>
        </>
      ) : null}

      <FieldError message={error} />
      <Button type="submit" disabled={pending}>
        Kaydet
      </Button>
      <Button type="button" variant="ghost" disabled={pending} onClick={() => setKind(null)}>
        Türü değiştir
      </Button>
    </form>
  );
}
