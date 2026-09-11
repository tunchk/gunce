"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button, FieldError, TextField } from "@/components/ui";
import { commitmentDateLabel, commitmentTypeLabel, studyStepMeta, studyStepStatusLabel } from "@/lib/plan-ui";
import type { CommitmentView, StudyStepStatus, StudyStepView } from "@/lib/plan";

export function CommitmentEditor({
  commitment,
  studySteps,
}: {
  commitment: CommitmentView;
  studySteps: StudyStepView[];
}) {
  const router = useRouter();
  const [title, setTitle] = useState(commitment.title);
  const [subject, setSubject] = useState(commitment.subject);
  const [dueDate, setDueDate] = useState(commitment.dueDate || "");
  const [dateUnknown, setDateUnknown] = useState(
    commitment.type === "HOMEWORK" && !commitment.dueDate,
  );
  const [eventDate, setEventDate] = useState(commitment.eventDate || "");
  const [eventTimeLocal, setEventTimeLocal] = useState(commitment.eventTimeLocal || "");
  const [revision, setRevision] = useState(commitment.revision);
  const [completedAt, setCompletedAt] = useState(commitment.completedAt);
  const [error, setError] = useState<string>();
  const [pending, setPending] = useState(false);
  const [deleteMode, setDeleteMode] = useState(false);

  async function save() {
    setPending(true);
    setError(undefined);
    try {
      const res = await fetch(`/api/child/plan/commitment/${commitment.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          op: "update",
          expectedRevision: revision,
          title,
          subject,
          dueDate: dueDate || null,
          dateUnknown: commitment.type === "HOMEWORK" ? dateUnknown : false,
          eventDate: eventDate || null,
          eventTimeLocal: eventTimeLocal || null,
        }),
      });
      const data = (await res.json()) as {
        error?: string;
        commitment?: CommitmentView;
      };
      if (!res.ok) {
        setError(data.error || "Kaydedilemedi.");
        setPending(false);
        return;
      }
      setRevision(data.commitment!.revision);
      router.refresh();
      setPending(false);
    } catch {
      setError("Bağlantı hatası. Girdiğin bilgiler duruyor.");
      setPending(false);
    }
  }

  async function setCompleted(completed: boolean) {
    setPending(true);
    setError(undefined);
    try {
      const res = await fetch(`/api/child/plan/commitment/${commitment.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          op: "set_completed",
          expectedRevision: revision,
          completed,
        }),
      });
      const data = (await res.json()) as {
        error?: string;
        commitment?: CommitmentView;
      };
      if (!res.ok) {
        setError(data.error || "Güncellenemedi.");
        setPending(false);
        return;
      }
      setRevision(data.commitment!.revision);
      setCompletedAt(data.commitment!.completedAt);
      router.refresh();
      setPending(false);
    } catch {
      setError("Bağlantı hatası.");
      setPending(false);
    }
  }

  async function remove(linkedSteps: "keep" | "delete") {
    setPending(true);
    setError(undefined);
    try {
      const res = await fetch(`/api/child/plan/commitment/${commitment.id}`, {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ linkedSteps }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) {
        setError(data.error || "Silinemedi.");
        setPending(false);
        return;
      }
      router.replace("/cocuk/haftam");
      router.refresh();
    } catch {
      setError("Bağlantı hatası.");
      setPending(false);
    }
  }

  return (
    <div className="space-y-4">
      <p className="text-sm" style={{ color: "var(--muted)" }}>
        {commitmentTypeLabel(commitment.type)} · {commitmentDateLabel(commitment)}
      </p>
      <TextField label="Başlık" name="c-title" value={title} onChange={(e) => setTitle(e.target.value)} />
      <TextField
        label="Ders / konu"
        name="c-subject"
        value={subject}
        onChange={(e) => setSubject(e.target.value)}
      />
      {commitment.type === "HOMEWORK" ? (
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
              name="c-due"
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
            />
          ) : null}
        </>
      ) : (
        <>
          <TextField
            label="Tarih"
            name="c-event"
            type="date"
            value={eventDate}
            onChange={(e) => setEventDate(e.target.value)}
          />
          <TextField
            label="Saat"
            name="c-time"
            type="time"
            value={eventTimeLocal}
            onChange={(e) => setEventTimeLocal(e.target.value)}
          />
        </>
      )}

      <Button type="button" disabled={pending} onClick={() => void save()}>
        Değişiklikleri kaydet
      </Button>

      {completedAt ? (
        <Button
          type="button"
          variant="secondary"
          disabled={pending}
          onClick={() => void setCompleted(false)}
        >
          Tamamlandı işaretini kaldır
        </Button>
      ) : (
        <Button
          type="button"
          variant="secondary"
          disabled={pending}
          onClick={() => void setCompleted(true)}
        >
          Tamamladım
        </Button>
      )}

      <div>
        <h3 className="text-sm font-semibold">Hazırlık adımları</h3>
        <ul className="mt-2 space-y-2">
          {studySteps.map((s) => (
            <li key={s.id}>
              <Link
                href={`/cocuk/plan/adim/${s.id}`}
                className="block rounded-2xl border px-3 py-3 text-sm"
                style={{ borderColor: "var(--line)" }}
              >
                {s.status === "DONE" ? "✓ " : ""}
                {s.title}
                <span className="mt-1 block" style={{ color: "var(--muted)" }}>
                  {studyStepStatusLabel(s.status)} · {studyStepMeta(s)}
                </span>
              </Link>
            </li>
          ))}
        </ul>
        {(commitment.type === "HOMEWORK" || commitment.type === "EXAM") && (
          <Link
            href={`/cocuk/plan/yeni?related=${commitment.id}&step=1`}
            className="mt-3 inline-flex min-h-11 items-center text-sm font-semibold underline"
          >
            Hazırlık adımı ekle
          </Link>
        )}
      </div>

      {!deleteMode ? (
        <Button type="button" variant="danger" onClick={() => setDeleteMode(true)}>
          Sil
        </Button>
      ) : (
        <div className="space-y-3 rounded-2xl border p-4" style={{ borderColor: "var(--danger)" }}>
          <p className="text-sm leading-relaxed">
            Bu işi silmek istiyor musun?
            {studySteps.length > 0
              ? " Bağlı hazırlık adımları için bir seçim yap."
              : ""}
          </p>
          {studySteps.length > 0 ? (
            <>
              <Button
                type="button"
                variant="danger"
                disabled={pending}
                onClick={() => void remove("keep")}
              >
                Adımları bağımsız bırak, işi sil
              </Button>
              <Button
                type="button"
                variant="danger"
                disabled={pending}
                onClick={() => void remove("delete")}
              >
                Adımları da sil
              </Button>
            </>
          ) : (
            <Button
              type="button"
              variant="danger"
              disabled={pending}
              onClick={() => void remove("keep")}
            >
              Evet, sil
            </Button>
          )}
          <Button type="button" variant="ghost" onClick={() => setDeleteMode(false)}>
            Vazgeç
          </Button>
        </div>
      )}
      <FieldError message={error} />
    </div>
  );
}

export function StudyStepEditor({
  step,
  linkables,
}: {
  step: StudyStepView;
  linkables: CommitmentView[];
}) {
  const router = useRouter();
  const [title, setTitle] = useState(step.title);
  const [subject, setSubject] = useState(step.subject);
  const [plannedDate, setPlannedDate] = useState(step.plannedDate || "");
  const [estimatedMinutes, setEstimatedMinutes] = useState(
    step.estimatedMinutes?.toString() || "",
  );
  const [reminderLocalTime, setReminderLocalTime] = useState(
    step.reminderLocalTime || "",
  );
  const [relatedCommitmentId, setRelatedCommitmentId] = useState(
    step.relatedCommitmentId || "",
  );
  const [revision, setRevision] = useState(step.revision);
  const [status, setStatus] = useState<StudyStepStatus>(step.status);
  const [error, setError] = useState<string>();
  const [pending, setPending] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  async function save(allowAfterDeadline = false) {
    setPending(true);
    setError(undefined);
    try {
      const res = await fetch(`/api/child/plan/step/${step.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          op: "update",
          expectedRevision: revision,
          title,
          subject,
          plannedDate: plannedDate || null,
          estimatedMinutes: estimatedMinutes ? Number(estimatedMinutes) : null,
          reminderLocalTime: reminderLocalTime || null,
          relatedCommitmentId: relatedCommitmentId || null,
          allowAfterDeadline,
        }),
      });
      const data = (await res.json()) as {
        error?: string;
        code?: string;
        studyStep?: StudyStepView;
      };
      if (res.status === 409 && data.code === "DEADLINE_WARNING" && !allowAfterDeadline) {
        const ok = window.confirm(
          `${data.error || "Planlanan gün, bağlı işin tarihinden sonra."} Yine de kaydetmek istiyor musun?`,
        );
        if (ok) {
          await save(true);
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
      setRevision(data.studyStep!.revision);
      setReminderLocalTime(data.studyStep!.reminderLocalTime || "");
      router.refresh();
      setPending(false);
    } catch {
      setError("Bağlantı hatası. Girdiğin bilgiler duruyor.");
      setPending(false);
    }
  }

  async function setStepStatus(next: StudyStepStatus) {
    setPending(true);
    setError(undefined);
    try {
      const res = await fetch(`/api/child/plan/step/${step.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          op: "set_status",
          expectedRevision: revision,
          status: next,
        }),
      });
      const data = (await res.json()) as {
        error?: string;
        studyStep?: StudyStepView;
      };
      if (!res.ok) {
        setError(data.error || "Güncellenemedi.");
        setPending(false);
        return;
      }
      setRevision(data.studyStep!.revision);
      setStatus(data.studyStep!.status);
      router.refresh();
      setPending(false);
    } catch {
      setError("Bağlantı hatası.");
      setPending(false);
    }
  }

  async function remove() {
    setPending(true);
    setError(undefined);
    try {
      const res = await fetch(`/api/child/plan/step/${step.id}`, { method: "DELETE" });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) {
        setError(data.error || "Silinemedi.");
        setPending(false);
        return;
      }
      router.replace("/cocuk/haftam");
      router.refresh();
    } catch {
      setError("Bağlantı hatası.");
      setPending(false);
    }
  }

  return (
    <div className="space-y-4">
      {step.afterDeadline ? (
        <p className="rounded-2xl border p-3 text-sm" style={{ borderColor: "var(--warn)" }}>
          Bu adım, bağlı işin tarihinden sonraya planlanmış.
        </p>
      ) : null}
      <TextField label="Başlık" name="s-title" value={title} onChange={(e) => setTitle(e.target.value)} />
      <TextField
        label="Ders / konu"
        name="s-subject"
        value={subject}
        onChange={(e) => setSubject(e.target.value)}
      />
      <TextField
        label="Planlanan gün"
        name="s-planned"
        type="date"
        value={plannedDate}
        onChange={(e) => setPlannedDate(e.target.value)}
      />
      <TextField
        label="Tahmini süre (dk)"
        name="s-mins"
        type="number"
        min={1}
        max={1440}
        value={estimatedMinutes}
        onChange={(e) => setEstimatedMinutes(e.target.value)}
      />
      <TextField
        label="Hatırlatma saati (isteğe bağlı)"
        name="s-reminder"
        type="time"
        value={reminderLocalTime}
        onChange={(e) => setReminderLocalTime(e.target.value)}
        disabled={!plannedDate}
      />
      <p className="text-sm" style={{ color: "var(--muted)" }}>
        Bu saat bir hatırlatma zamanıdır; ölçülen çalışma başlangıcı değildir. Planlanan gün
        olmadan hatırlatma açılamaz. Genel hatırlatmalar kapalıysa gönderilmez.
      </p>
      <label className="block text-sm font-semibold" htmlFor="s-related">
        Bağlı ödev / sınav
      </label>
      <select
        id="s-related"
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

      <Button type="button" disabled={pending} onClick={() => void save(false)}>
        Değişiklikleri kaydet
      </Button>

      <p className="text-sm" style={{ color: "var(--muted)" }}>
        Durum: {studyStepStatusLabel(status)}
      </p>
      {status === "DONE" ? (
        <Button
          type="button"
          variant="secondary"
          disabled={pending}
          onClick={() => void setStepStatus("TODO")}
        >
          Yapılacaklara al
        </Button>
      ) : (
        <>
          {status === "TODO" ? (
            <Button
              type="button"
              variant="secondary"
              disabled={pending}
              onClick={() => void setStepStatus("IN_PROGRESS")}
            >
              Başla
            </Button>
          ) : null}
          <Button
            type="button"
            variant="secondary"
            disabled={pending}
            onClick={() => void setStepStatus("DONE")}
          >
            Tamamladım
          </Button>
        </>
      )}

      {!confirmDelete ? (
        <Button type="button" variant="danger" onClick={() => setConfirmDelete(true)}>
          Sil
        </Button>
      ) : (
        <div className="space-y-3 rounded-2xl border p-4" style={{ borderColor: "var(--danger)" }}>
          <p className="text-sm">Bu adımı silmek istediğine emin misin?</p>
          <Button type="button" variant="danger" disabled={pending} onClick={() => void remove()}>
            Evet, sil
          </Button>
          <Button type="button" variant="ghost" onClick={() => setConfirmDelete(false)}>
            Vazgeç
          </Button>
        </div>
      )}
      <FieldError message={error} />
    </div>
  );
}
