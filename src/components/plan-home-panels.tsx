"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { CompletionReflectionPrompt } from "@/components/completion-reflection-prompt";
import { StudyStatusBadge } from "@/components/study-status-badge";
import { Button, FieldError } from "@/components/ui";
import type { StudyStepView } from "@/lib/plan";
import { calendarDateInTimeZone } from "@/lib/plan-dates";
import { studyStepMeta } from "@/lib/plan-ui";

const NOTICE_KEY = "gunce-plan-parent-notice-seen";

export function PlanParentNotice() {
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
      <p>Planına eklediğin işleri velin de görebilir.</p>
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

export function NextStudyStepPanel({
  step,
  compact = false,
}: {
  step: StudyStepView | null;
  compact?: boolean;
}) {
  const router = useRouter();
  const [error, setError] = useState<string>();
  const [pending, setPending] = useState(false);
  const [moving, setMoving] = useState(false);
  const [moveDate, setMoveDate] = useState("");
  const [localStep, setLocalStep] = useState(step);
  const [showReflection, setShowReflection] = useState(false);
  const today = calendarDateInTimeZone("Europe/Istanbul");

  useEffect(() => {
    setLocalStep(step);
  }, [step]);

  async function complete() {
    if (!localStep) return;
    setPending(true);
    setError(undefined);
    try {
      const res = await fetch(`/api/child/plan/step/${localStep.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          op: "set_status",
          expectedRevision: localStep.revision,
          status: "DONE",
        }),
      });
      const data = (await res.json()) as {
        error?: string;
        studyStep?: StudyStepView;
      };
      if (!res.ok || !data.studyStep) {
        setError(data.error || "Kaydedilemedi.");
        setPending(false);
        return;
      }
      setLocalStep(data.studyStep);
      setShowReflection(true);
      setPending(false);
      router.refresh();
    } catch {
      setError("Bağlantı hatası.");
      setPending(false);
    }
  }

  async function reschedule() {
    if (!localStep || !moveDate) {
      setError("Yeni bir gün seç.");
      return;
    }
    setPending(true);
    setError(undefined);
    try {
      const res = await fetch(`/api/child/plan/step/${localStep.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          op: "reschedule",
          expectedRevision: localStep.revision,
          plannedDate: moveDate,
          allowAfterDeadline: false,
        }),
      });
      const data = (await res.json()) as {
        error?: string;
        code?: string;
        details?: { deadline?: string };
      };
      if (res.status === 409 && data.code === "DEADLINE_WARNING") {
        const ok = window.confirm(
          `${data.error || "Bu gün bağlı işin tarihinden sonra."} Yine de taşımak istiyor musun?`,
        );
        if (!ok) {
          setPending(false);
          return;
        }
        const retry = await fetch(`/api/child/plan/step/${localStep.id}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            op: "reschedule",
            expectedRevision: localStep.revision,
            plannedDate: moveDate,
            allowAfterDeadline: true,
          }),
        });
        const retryData = (await retry.json()) as { error?: string };
        if (!retry.ok) {
          setError(retryData.error || "Taşınamadı.");
          setPending(false);
          return;
        }
        router.refresh();
        return;
      }
      if (!res.ok) {
        setError(data.error || "Taşınamadı.");
        setPending(false);
        return;
      }
      router.refresh();
    } catch {
      setError("Bağlantı hatası.");
      setPending(false);
    }
  }

  if (!localStep) {
    return (
      <div>
        <h2 className="text-lg font-semibold">Sıradaki adımım</h2>
        <p className="mt-2 text-sm leading-relaxed" style={{ color: "var(--muted)" }}>
          Bugün için seçilmiş bir çalışma adımı yok. İstersen haftalık plana bir şey ekleyebilirsin.
        </p>
        <div className="mt-3 flex flex-col gap-2">
          <Link href="/cocuk/plan/yeni" className="block">
            <Button variant="secondary">Plan ekle</Button>
          </Link>
          <Link
            href="/cocuk/haftam"
            className="inline-flex min-h-12 items-center justify-center text-sm font-semibold underline"
          >
            Haftalık plana git
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div>
      <h2 className="text-lg font-semibold">Sıradaki adımım</h2>
      <div className="mt-2">
        <StudyStatusBadge
          status={localStep.status}
          plannedDate={localStep.plannedDate}
          today={today}
        />
      </div>
      <p className="mt-2 text-base font-medium">{localStep.title}</p>
      <p className="mt-1 text-sm" style={{ color: "var(--muted)" }}>
        {studyStepMeta(localStep)}
      </p>
      {!moving && localStep.status !== "DONE" ? (
        <div className="mt-4 flex flex-col gap-2">
          <Button type="button" disabled={pending} onClick={() => void complete()}>
            Tamamladım
          </Button>
          {!compact ? (
            <Button
              type="button"
              variant="secondary"
              disabled={pending}
              onClick={() => setMoving(true)}
            >
              Başka güne taşı
            </Button>
          ) : (
            <Link
              href={`/cocuk/plan/adim/${localStep.id}`}
              className="inline-flex min-h-12 items-center justify-center rounded-2xl px-4 text-sm font-semibold"
              style={{ background: "var(--accent-soft)" }}
            >
              Adımı aç
            </Link>
          )}
          {!compact ? (
            <Link
              href={`/cocuk/plan/adim/${localStep.id}`}
              className="inline-flex min-h-11 items-center justify-center text-sm font-semibold underline"
            >
              Düzenle
            </Link>
          ) : null}
        </div>
      ) : moving ? (
        <div className="mt-4 space-y-3">
          <label className="block text-sm font-semibold" htmlFor="move-date">
            Yeni gün
          </label>
          <input
            id="move-date"
            type="date"
            className="min-h-12 w-full rounded-2xl border px-4"
            style={{ borderColor: "var(--line)", background: "white" }}
            value={moveDate}
            onChange={(e) => setMoveDate(e.target.value)}
          />
          <Button type="button" disabled={pending} onClick={() => void reschedule()}>
            Taşı
          </Button>
          <Button
            type="button"
            variant="ghost"
            disabled={pending}
            onClick={() => {
              setMoving(false);
              setError(undefined);
            }}
          >
            Vazgeç
          </Button>
        </div>
      ) : null}

      {showReflection && localStep.status === "DONE" ? (
        <CompletionReflectionPrompt
          step={localStep}
          onUpdated={(next) => setLocalStep(next)}
          onDismiss={() => {
            setShowReflection(false);
            router.refresh();
          }}
        />
      ) : null}
      <FieldError message={error} />
    </div>
  );
}

export function MissedStepsPanel({ steps }: { steps: StudyStepView[] }) {
  if (steps.length === 0) return null;
  return (
    <div className="mt-4 border-t pt-4" style={{ borderColor: "var(--line)" }}>
      <h3 className="text-sm font-semibold">Yeniden planlanacaklar</h3>
      <p className="mt-1 text-sm" style={{ color: "var(--muted)" }}>
        Geçmiş günlerde kalan adımlar burada duruyor; kaybolmazlar.
      </p>
      <ul className="mt-3 space-y-2">
        {steps.map((s) => (
          <li key={s.id}>
            <Link
              href={`/cocuk/plan/adim/${s.id}`}
              className="block rounded-2xl border px-3 py-3 text-sm"
              style={{ borderColor: "var(--line)" }}
            >
              <StudyStatusBadge
                status={s.status}
                plannedDate={s.plannedDate}
                today={calendarDateInTimeZone("Europe/Istanbul")}
              />
              <span className="mt-2 block font-medium">{s.title}</span>
              <span className="mt-1 block" style={{ color: "var(--muted)" }}>
                {studyStepMeta(s)}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
