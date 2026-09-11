"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Button, FieldError } from "@/components/ui";
import type { StudyStepView } from "@/lib/plan";
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

export function NextStudyStepPanel({ step }: { step: StudyStepView | null }) {
  const router = useRouter();
  const [error, setError] = useState<string>();
  const [pending, setPending] = useState(false);
  const [moving, setMoving] = useState(false);
  const [moveDate, setMoveDate] = useState("");

  async function complete() {
    if (!step) return;
    setPending(true);
    setError(undefined);
    try {
      const res = await fetch(`/api/child/plan/step/${step.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          op: "set_status",
          expectedRevision: step.revision,
          status: "DONE",
        }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) {
        setError(data.error || "Kaydedilemedi.");
        setPending(false);
        return;
      }
      router.refresh();
    } catch {
      setError("Bağlantı hatası.");
      setPending(false);
    }
  }

  async function reschedule() {
    if (!step || !moveDate) {
      setError("Yeni bir gün seç.");
      return;
    }
    setPending(true);
    setError(undefined);
    try {
      const res = await fetch(`/api/child/plan/step/${step.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          op: "reschedule",
          expectedRevision: step.revision,
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
        const retry = await fetch(`/api/child/plan/step/${step.id}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            op: "reschedule",
            expectedRevision: step.revision,
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

  if (!step) {
    return (
      <div>
        <h2 className="text-lg font-semibold">Sıradaki adımım</h2>
        <p className="mt-2 text-sm leading-relaxed" style={{ color: "var(--muted)" }}>
          Bugün için planlanmış bir çalışma adımı yok. Haftana bakıp bir gün seçebilirsin.
        </p>
        <Link
          href="/cocuk/haftam"
          className="mt-3 inline-flex min-h-12 items-center text-sm font-semibold underline"
        >
          Haftama bak
        </Link>
      </div>
    );
  }

  return (
    <div>
      <h2 className="text-lg font-semibold">Sıradaki adımım</h2>
      <p className="mt-2 text-base font-medium">{step.title}</p>
      <p className="mt-1 text-sm" style={{ color: "var(--muted)" }}>
        {studyStepMeta(step)}
      </p>
      {!moving ? (
        <div className="mt-4 flex flex-col gap-2">
          <Button type="button" disabled={pending} onClick={() => void complete()}>
            Tamamladım
          </Button>
          <Button
            type="button"
            variant="secondary"
            disabled={pending}
            onClick={() => setMoving(true)}
          >
            Başka güne taşı
          </Button>
          <Link
            href={`/cocuk/plan/adim/${step.id}`}
            className="inline-flex min-h-11 items-center justify-center text-sm font-semibold underline"
          >
            Düzenle
          </Link>
        </div>
      ) : (
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
      )}
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
              <span className="font-medium">{s.title}</span>
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
