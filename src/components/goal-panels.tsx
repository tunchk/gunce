"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Button, FieldError, TextField } from "@/components/ui";
import type { GoalDetailView, GoalView } from "@/lib/goal";
import { formatDayLabelTr, formatLongDateTr } from "@/lib/plan-dates";
import { newClientRequestId, studyStepMeta, studyStepStatusLabel, goalLifecycleLabel } from "@/lib/plan-ui";

const NOTICE_KEY = "gunce-goal-parent-notice-seen";

export function GoalParentNotice() {
  const [show, setShow] = useState(false);
  useEffect(() => {
    try {
      if (!localStorage.getItem(NOTICE_KEY)) setShow(true);
    } catch {
      setShow(true);
    }
  }, []);
  if (!show) return null;
  return (
    <div
      className="rounded-2xl border p-4 text-sm leading-relaxed"
      style={{ borderColor: "var(--line)", background: "var(--accent-soft)" }}
      role="status"
    >
      <p>Hedeflerini ve eklediğin adımları velin de görebilir.</p>
      <button
        type="button"
        className="mt-3 text-sm font-semibold underline"
        onClick={() => {
          try {
            localStorage.setItem(NOTICE_KEY, "1");
          } catch {
            /* ignore */
          }
          setShow(false);
        }}
      >
        Anladım
      </button>
    </div>
  );
}

export function goalStatusLabel(status: GoalView["status"]): string {
  return goalLifecycleLabel(status);
}

export function GoalProgressBar({ goal }: { goal: GoalView }) {
  if (goal.progress.totalCount === 0) {
    return (
      <p className="mt-2 text-sm" style={{ color: "var(--muted)" }}>
        İlk küçük adımını ekle.
      </p>
    );
  }
  const pct = Math.round((goal.progress.ratio ?? 0) * 100);
  return (
    <div className="mt-3">
      <p className="text-sm font-medium">{goal.progress.label}</p>
      <div
        className="mt-2 h-2 w-full overflow-hidden rounded-full"
        style={{ background: "var(--line)" }}
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={goal.progress.label}
      >
        <div
          className="h-full rounded-full"
          style={{ width: `${pct}%`, background: "var(--accent)" }}
        />
      </div>
    </div>
  );
}

export function GoalCard({ goal }: { goal: GoalView }) {
  return (
    <Link
      href={`/cocuk/hedefler/${goal.id}`}
      className="block rounded-2xl border px-4 py-4"
      style={{ borderColor: "var(--line)", background: "white" }}
    >
      <p className="text-xs font-semibold" style={{ color: "var(--muted)" }}>
        {goalStatusLabel(goal.status)}
        {goal.targetDate ? ` · hedef: ${formatDayLabelTr(goal.targetDate)}` : ""}
      </p>
      <p className="mt-1 text-base font-semibold">{goal.title}</p>
      <GoalProgressBar goal={goal} />
    </Link>
  );
}

export function GoalCreateForm() {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [targetDate, setTargetDate] = useState("");
  const [error, setError] = useState<string>();
  const [pending, setPending] = useState(false);
  const [requestId] = useState(() => newClientRequestId());
  const [created, setCreated] = useState<GoalView | null>(null);

  async function submit() {
    setPending(true);
    setError(undefined);
    try {
      const res = await fetch("/api/child/goals", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title,
          description,
          targetDate: targetDate || null,
          clientRequestId: requestId,
        }),
      });
      const data = (await res.json()) as { error?: string; goal?: GoalView };
      if (!res.ok) {
        setError(data.error || "Kaydedilemedi.");
        setPending(false);
        return;
      }
      setCreated(data.goal!);
      setPending(false);
    } catch {
      setError("Bağlantı hatası. Girdiğin bilgiler duruyor.");
      setPending(false);
    }
  }

  if (created) {
    return (
      <div className="space-y-4">
        <p className="text-base leading-relaxed">
          “{created.title}” kaydedildi. İlk küçük adımını eklemek ister misin?
        </p>
        <Link href={`/cocuk/hedefler/${created.id}?addStep=1`} className="block">
          <Button type="button">Evet, adım ekle</Button>
        </Link>
        <Link href={`/cocuk/hedefler/${created.id}`} className="block">
          <Button type="button" variant="ghost">
            Şimdilik değil
          </Button>
        </Link>
      </div>
    );
  }

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <TextField
        label="Hedef başlığı"
        name="goal-title"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        required
        maxLength={200}
      />
      <label className="block text-sm font-semibold" htmlFor="goal-desc">
        Ne öğrenmek / başarmak istiyorsun? (isteğe bağlı)
      </label>
      <textarea
        id="goal-desc"
        className="min-h-24 w-full rounded-2xl border px-4 py-3 text-base"
        style={{ borderColor: "var(--line)", background: "white" }}
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        maxLength={1000}
      />
      <TextField
        label="Hedef tarih (isteğe bağlı)"
        name="goal-target"
        type="date"
        value={targetDate}
        onChange={(e) => setTargetDate(e.target.value)}
      />
      <FieldError message={error} />
      <Button type="submit" disabled={pending}>
        Kaydet
      </Button>
    </form>
  );
}

export function GoalDetailEditor({
  initial,
  offerAddStep,
}: {
  initial: GoalDetailView;
  offerAddStep?: boolean;
}) {
  const router = useRouter();
  const [goal, setGoal] = useState(initial);
  const [title, setTitle] = useState(initial.title);
  const [description, setDescription] = useState(initial.description);
  const [targetDate, setTargetDate] = useState(initial.targetDate || "");
  const [error, setError] = useState<string>();
  const [pending, setPending] = useState(false);
  const [adding, setAdding] = useState(Boolean(offerAddStep));
  const [attaching, setAttaching] = useState(false);
  const [stepTitle, setStepTitle] = useState("");
  const [stepDate, setStepDate] = useState("");
  const [stepMins, setStepMins] = useState("");
  const [unlinked, setUnlinked] = useState<
    { id: string; title: string; revision: number; relatedGoalId: string | null }[]
  >([]);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [achieveNote, setAchieveNote] = useState(false);

  useEffect(() => {
    setGoal(initial);
    setTitle(initial.title);
    setDescription(initial.description);
    setTargetDate(initial.targetDate || "");
  }, [initial]);

  async function saveGoal() {
    setPending(true);
    setError(undefined);
    try {
      const res = await fetch(`/api/child/goals/${goal.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          op: "update",
          expectedRevision: goal.revision,
          title,
          description,
          targetDate: targetDate || null,
        }),
      });
      const data = (await res.json()) as { error?: string; goal?: GoalDetailView };
      if (!res.ok) {
        setError(data.error || "Kaydedilemedi.");
        setPending(false);
        return;
      }
      setGoal(data.goal!);
      setPending(false);
      router.refresh();
    } catch {
      setError("Bağlantı hatası.");
      setPending(false);
    }
  }

  async function setStatus(status: GoalView["status"]) {
    setPending(true);
    setError(undefined);
    try {
      const res = await fetch(`/api/child/goals/${goal.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          op: "set_status",
          expectedRevision: goal.revision,
          status,
        }),
      });
      const data = (await res.json()) as { error?: string; goal?: GoalDetailView };
      if (!res.ok) {
        setError(data.error || "Güncellenemedi.");
        setPending(false);
        return;
      }
      setGoal(data.goal!);
      setAchieveNote(false);
      setPending(false);
      router.refresh();
    } catch {
      setError("Bağlantı hatası.");
      setPending(false);
    }
  }

  async function addStep() {
    setPending(true);
    setError(undefined);
    try {
      const res = await fetch(`/api/child/goals/${goal.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          op: "add_step",
          title: stepTitle,
          plannedDate: stepDate || null,
          estimatedMinutes: stepMins ? Number(stepMins) : null,
          clientRequestId: newClientRequestId(),
        }),
      });
      const data = (await res.json()) as { error?: string; goal?: GoalDetailView };
      if (!res.ok) {
        setError(data.error || "Adım eklenemedi.");
        setPending(false);
        return;
      }
      setGoal(data.goal!);
      setStepTitle("");
      setStepDate("");
      setStepMins("");
      setAdding(false);
      setPending(false);
      router.refresh();
    } catch {
      setError("Bağlantı hatası.");
      setPending(false);
    }
  }

  async function loadUnlinked() {
    setAttaching(true);
    setError(undefined);
    try {
      const res = await fetch("/api/child/goals?unlinkedSteps=1");
      const data = (await res.json()) as {
        studySteps?: { id: string; title: string; revision: number; relatedGoalId: string | null }[];
      };
      setUnlinked(data.studySteps || []);
    } catch {
      setError("Adımlar yüklenemedi.");
      setAttaching(false);
    }
  }

  async function attach(stepId: string, revision: number, allowMove = false) {
    setPending(true);
    setError(undefined);
    try {
      const res = await fetch(`/api/child/goals/${goal.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          op: "attach_step",
          studyStepId: stepId,
          expectedStepRevision: revision,
          allowMove,
        }),
      });
      const data = (await res.json()) as {
        error?: string;
        code?: string;
        details?: { otherGoalTitle?: string };
        goal?: GoalDetailView;
      };
      if (
        res.status === 409 &&
        (data.details as { code?: string } | undefined)?.code === "GOAL_ALREADY_LINKED"
      ) {
        const other = data.details?.otherGoalTitle
          ? ` (“${data.details.otherGoalTitle}”)`
          : "";
        const ok = window.confirm(
          `${data.error || "Bu adım başka bir hedefe bağlı."}${other} Bu hedefe taşımak istiyor musun?`,
        );
        if (ok) {
          await attach(stepId, revision, true);
          return;
        }
        setPending(false);
        return;
      }
      if (!res.ok) {
        setError(data.error || "Bağlanamadı.");
        setPending(false);
        return;
      }
      setGoal(data.goal!);
      setAttaching(false);
      setPending(false);
      router.refresh();
    } catch {
      setError("Bağlantı hatası.");
      setPending(false);
    }
  }

  async function detach(stepId: string, revision: number) {
    setPending(true);
    setError(undefined);
    try {
      const res = await fetch(`/api/child/goals/${goal.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          op: "detach_step",
          studyStepId: stepId,
          expectedStepRevision: revision,
        }),
      });
      const data = (await res.json()) as { error?: string; goal?: GoalDetailView };
      if (!res.ok) {
        setError(data.error || "Ayrılamadı.");
        setPending(false);
        return;
      }
      setGoal(data.goal!);
      setPending(false);
      router.refresh();
    } catch {
      setError("Bağlantı hatası.");
      setPending(false);
    }
  }

  async function removeGoal() {
    setPending(true);
    setError(undefined);
    try {
      const res = await fetch(`/api/child/goals/${goal.id}`, { method: "DELETE" });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) {
        setError(data.error || "Silinemedi.");
        setPending(false);
        return;
      }
      router.replace("/cocuk/hedefler");
      router.refresh();
    } catch {
      setError("Bağlantı hatası.");
      setPending(false);
    }
  }

  const remainingOpen = goal.studySteps.filter((s) => s.status !== "DONE").length;

  return (
    <div className="space-y-5">
      <p className="text-sm" style={{ color: "var(--muted)" }}>
        {goalStatusLabel(goal.status)}
        {goal.targetDate ? ` · hedef tarih: ${formatLongDateTr(goal.targetDate)}` : ""}
      </p>
      <GoalProgressBar goal={goal} />

      <TextField label="Başlık" name="g-title" value={title} onChange={(e) => setTitle(e.target.value)} />
      <label className="block text-sm font-semibold" htmlFor="g-desc">
        Açıklama
      </label>
      <textarea
        id="g-desc"
        className="min-h-24 w-full rounded-2xl border px-4 py-3"
        style={{ borderColor: "var(--line)", background: "white" }}
        value={description}
        onChange={(e) => setDescription(e.target.value)}
      />
      <TextField
        label="Hedef tarih"
        name="g-target"
        type="date"
        value={targetDate}
        onChange={(e) => setTargetDate(e.target.value)}
      />
      <Button type="button" disabled={pending} onClick={() => void saveGoal()}>
        Değişiklikleri kaydet
      </Button>

      <section>
        <h3 className="text-sm font-semibold">Adımlar</h3>
        {goal.studySteps.length === 0 ? (
          <p className="mt-2 text-sm" style={{ color: "var(--muted)" }}>
            İlk küçük adımını ekle.
          </p>
        ) : (
          <ul className="mt-2 space-y-2">
            {goal.studySteps.map((s) => (
              <li
                key={s.id}
                className="rounded-2xl border px-3 py-3"
                style={{ borderColor: "var(--line)" }}
              >
                <Link href={`/cocuk/plan/adim/${s.id}`} className="block">
                  <p className="text-xs font-semibold" style={{ color: "var(--muted)" }}>
                    {studyStepStatusLabel(s.status)}
                  </p>
                  <p className="font-medium">{s.title}</p>
                  <p className="text-sm" style={{ color: "var(--muted)" }}>
                    {studyStepMeta(s)}
                  </p>
                </Link>
                <button
                  type="button"
                  className="mt-2 text-sm font-semibold underline"
                  disabled={pending}
                  onClick={() => void detach(s.id, s.revision)}
                >
                  Hedeften ayır
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {!adding ? (
        <Button type="button" variant="secondary" onClick={() => setAdding(true)}>
          Yeni adım ekle
        </Button>
      ) : (
        <div className="space-y-3 rounded-2xl border p-4" style={{ borderColor: "var(--line)" }}>
          <TextField
            label="Adım başlığı"
            name="step-title"
            value={stepTitle}
            onChange={(e) => setStepTitle(e.target.value)}
          />
          <TextField
            label="Planlanan gün (isteğe bağlı)"
            name="step-date"
            type="date"
            value={stepDate}
            onChange={(e) => setStepDate(e.target.value)}
          />
          <TextField
            label="Tahmini süre (dk)"
            name="step-mins"
            type="number"
            min={1}
            value={stepMins}
            onChange={(e) => setStepMins(e.target.value)}
          />
          <Button type="button" disabled={pending} onClick={() => void addStep()}>
            Adımı kaydet
          </Button>
          <Button type="button" variant="ghost" onClick={() => setAdding(false)}>
            Vazgeç
          </Button>
        </div>
      )}

      {!attaching ? (
        <Button type="button" variant="ghost" onClick={() => void loadUnlinked()}>
          Mevcut adımı bağla
        </Button>
      ) : (
        <div className="space-y-2 rounded-2xl border p-4" style={{ borderColor: "var(--line)" }}>
          <p className="text-sm font-semibold">Bağlanabilir adımlar</p>
          {unlinked.length === 0 ? (
            <p className="text-sm" style={{ color: "var(--muted)" }}>
              Bağlanacak bağımsız adım yok.
            </p>
          ) : (
            unlinked.map((s) => (
              <button
                key={s.id}
                type="button"
                className="block w-full rounded-2xl border px-3 py-3 text-left text-sm"
                style={{ borderColor: "var(--line)" }}
                disabled={pending}
                onClick={() => void attach(s.id, s.revision)}
              >
                {s.title}
              </button>
            ))
          )}
          <Button type="button" variant="ghost" onClick={() => setAttaching(false)}>
            Kapat
          </Button>
        </div>
      )}

      {goal.status === "ACTIVE" ? (
        !achieveNote ? (
          <Button type="button" variant="secondary" onClick={() => setAchieveNote(true)}>
            Hedefime ulaştım
          </Button>
        ) : (
          <div className="space-y-3 rounded-2xl border p-4" style={{ borderColor: "var(--line)" }}>
            <p className="text-sm leading-relaxed">
              Hedefi tamamlandı olarak işaretleyeceksin.
              {remainingOpen > 0
                ? ` Kalan ${remainingOpen} adımın durumu değişmez; haftalık planda durmaya devam eder.`
                : " Tüm adımlar tamamlanmış görünüyor."}
            </p>
            <Button
              type="button"
              disabled={pending}
              onClick={() => void setStatus("ACHIEVED")}
            >
              Evet, ulaştım
            </Button>
            <Button type="button" variant="ghost" onClick={() => setAchieveNote(false)}>
              Vazgeç
            </Button>
          </div>
        )
      ) : null}

      {goal.status === "ACHIEVED" ? (
        <Button
          type="button"
          variant="secondary"
          disabled={pending}
          onClick={() => void setStatus("ACTIVE")}
        >
          Hedefi yeniden aç
        </Button>
      ) : null}

      {goal.status !== "ARCHIVED" ? (
        <Button
          type="button"
          variant="ghost"
          disabled={pending}
          onClick={() => void setStatus("ARCHIVED")}
        >
          Arşivle
        </Button>
      ) : (
        <Button
          type="button"
          variant="secondary"
          disabled={pending}
          onClick={() => void setStatus("ACTIVE")}
        >
          Arşivden çıkar
        </Button>
      )}
      {goal.status === "ARCHIVED" ? (
        <p className="text-sm" style={{ color: "var(--muted)" }}>
          Arşivlenen hedefin adımları silinmez; planladığın günler haftalık planda kalır.
        </p>
      ) : null}

      {!confirmDelete ? (
        <Button type="button" variant="danger" onClick={() => setConfirmDelete(true)}>
          Hedefi sil
        </Button>
      ) : (
        <div className="space-y-3 rounded-2xl border p-4" style={{ borderColor: "var(--danger)" }}>
          <p className="text-sm leading-relaxed">
            Hedef silinecek. Bağlı çalışma adımları silinmez; yalnızca hedef bağlantısı kalkar.
          </p>
          <Button type="button" variant="danger" disabled={pending} onClick={() => void removeGoal()}>
            Evet, hedefi sil
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
