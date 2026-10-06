"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { CompletionReflectionPrompt } from "@/components/completion-reflection-prompt";
import { StudyStatusBadge } from "@/components/study-status-badge";
import { Button, FieldError } from "@/components/ui";
import type { CommitmentView, StudyStepStatus, StudyStepView } from "@/lib/plan";
import { addCalendarDays, formatDayLabelTr } from "@/lib/plan-dates";
import {
  commitmentDateLabel,
  commitmentTypeLabel,
  studyStepMeta,
  studyStepStatusLabel,
} from "@/lib/plan-ui";

export type PlanningWeek = {
  today: string;
  weekStart: string;
  weekEnd: string;
  days: {
    date: string;
    commitments: CommitmentView[];
    studySteps: StudyStepView[];
    studyStepCount: number;
    studyMinutes: number;
  }[];
  unscheduled: StudyStepView[];
  missed: StudyStepView[];
};

type ViewMode = "hafta" | "pano";

/** Prefer tabs when the planning content column itself is too narrow for 3 cards. */
const BOARD_THREE_COL_MIN = 900;

const COLUMNS: StudyStepStatus[] = ["TODO", "IN_PROGRESS", "DONE"];

function weekHref(weekStart: string, view: ViewMode) {
  const params = new URLSearchParams({ view });
  if (weekStart) params.set("weekStart", weekStart);
  return `/cocuk/haftam?${params.toString()}`;
}

export function PlanningViewTabs({
  weekStart,
  view,
}: {
  weekStart: string;
  view: ViewMode;
}) {
  return (
    <div className="grid grid-cols-2 gap-2" role="tablist" aria-label="Plan görünümü">
      {(
        [
          ["hafta", "Hafta"],
          ["pano", "Pano"],
        ] as const
      ).map(([id, label]) => {
        const selected = view === id;
        return (
          <Link
            key={id}
            href={weekHref(weekStart, id)}
            role="tab"
            aria-selected={selected}
            className="inline-flex min-h-12 items-center justify-center rounded-2xl px-4 text-sm font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
            style={{
              border: selected ? "2px solid var(--accent)" : "1px solid var(--line)",
              background: selected ? "var(--accent-soft)" : "white",
              outlineColor: "var(--accent)",
            }}
          >
            {label}
          </Link>
        );
      })}
    </div>
  );
}

export function WeekNav({
  week,
  view,
  readOnly = false,
}: {
  week: PlanningWeek;
  view: ViewMode;
  readOnly?: boolean;
}) {
  const router = useRouter();
  const base = readOnly ? "/veli/plan" : "/cocuk/haftam";

  function go(offset: number) {
    const next = addCalendarDays(week.weekStart, offset * 7);
    const params = new URLSearchParams();
    if (!readOnly) params.set("view", view);
    params.set("weekStart", next);
    router.push(`${base}?${params.toString()}`);
  }

  function goThisWeek() {
    const params = new URLSearchParams();
    if (!readOnly) params.set("view", view);
    router.push(params.toString() ? `${base}?${params}` : base);
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <p className="text-sm font-semibold">
        {formatDayLabelTr(week.weekStart)} – {formatDayLabelTr(week.weekEnd)}
      </p>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className="min-h-11 rounded-2xl border px-3 text-sm font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
          style={{ borderColor: "var(--line)", outlineColor: "var(--accent)" }}
          onClick={() => go(-1)}
        >
          Önceki
        </button>
        <button
          type="button"
          className="min-h-11 rounded-2xl border px-3 text-sm font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
          style={{ borderColor: "var(--line)", outlineColor: "var(--accent)" }}
          onClick={goThisWeek}
        >
          Bu hafta
        </button>
        <button
          type="button"
          className="min-h-11 rounded-2xl border px-3 text-sm font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
          style={{ borderColor: "var(--line)", outlineColor: "var(--accent)" }}
          onClick={() => go(1)}
        >
          Sonraki
        </button>
      </div>
    </div>
  );
}

async function patchStatus(
  step: StudyStepView,
  status: StudyStepStatus,
): Promise<{ ok: true; studyStep: StudyStepView } | { ok: false; error: string }> {
  try {
    const res = await fetch(`/api/child/plan/step/${step.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        op: "set_status",
        expectedRevision: step.revision,
        status,
      }),
    });
    const data = (await res.json()) as { error?: string; studyStep?: StudyStepView };
    if (!res.ok || !data.studyStep) {
      return { ok: false, error: data.error || "Kaydedilemedi." };
    }
    return { ok: true, studyStep: data.studyStep };
  } catch {
    return { ok: false, error: "Bağlantı hatası." };
  }
}

function StepCard({
  step,
  readOnly,
  today,
  onChanged,
}: {
  step: StudyStepView;
  readOnly?: boolean;
  today: string;
  onChanged: (next: StudyStepView, opts?: { offerReflection?: boolean }) => void;
}) {
  const router = useRouter();
  const [error, setError] = useState<string>();
  const [pending, setPending] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [moving, setMoving] = useState(false);
  const [moveDate, setMoveDate] = useState(step.plannedDate || "");
  const [snapshot, setSnapshot] = useState(step);

  useEffect(() => {
    setSnapshot(step);
    setMoveDate(step.plannedDate || "");
  }, [step]);

  async function setStatus(status: StudyStepStatus) {
    if (status === "TODO" && snapshot.completionReflection) {
      const ok = window.confirm(
        "Yapılacaklara alınca tamamlanma notu da silinir. Devam etmek istiyor musun?",
      );
      if (!ok) return;
    }
    setPending(true);
    setError(undefined);
    const previous = snapshot;
    setSnapshot({ ...snapshot, status });
    const result = await patchStatus(previous, status);
    if (!result.ok) {
      setSnapshot(previous);
      setError(result.error);
      setPending(false);
      return;
    }
    setSnapshot(result.studyStep);
    onChanged(result.studyStep, {
      offerReflection: status === "DONE" && previous.status !== "DONE",
    });
    setPending(false);
    router.refresh();
  }

  async function reschedule() {
    if (!moveDate) {
      setError("Yeni bir gün seç.");
      return;
    }
    setPending(true);
    setError(undefined);
    try {
      const res = await fetch(`/api/child/plan/step/${snapshot.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          op: "reschedule",
          expectedRevision: snapshot.revision,
          plannedDate: moveDate,
          allowAfterDeadline: false,
        }),
      });
      const data = (await res.json()) as {
        error?: string;
        code?: string;
        studyStep?: StudyStepView;
      };
      if (res.status === 409 && data.code === "DEADLINE_WARNING") {
        const ok = window.confirm(
          `${data.error || "Bu gün bağlı işin tarihinden sonra."} Yine de taşımak istiyor musun?`,
        );
        if (!ok) {
          setPending(false);
          return;
        }
        const retry = await fetch(`/api/child/plan/step/${snapshot.id}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            op: "reschedule",
            expectedRevision: snapshot.revision,
            plannedDate: moveDate,
            allowAfterDeadline: true,
          }),
        });
        const retryData = (await retry.json()) as {
          error?: string;
          studyStep?: StudyStepView;
        };
        if (!retry.ok || !retryData.studyStep) {
          setError(retryData.error || "Taşınamadı.");
          setPending(false);
          return;
        }
        setSnapshot(retryData.studyStep);
        onChanged(retryData.studyStep);
        setMoving(false);
        setPending(false);
        router.refresh();
        return;
      }
      if (!res.ok || !data.studyStep) {
        setError(data.error || "Taşınamadı.");
        setPending(false);
        return;
      }
      setSnapshot(data.studyStep);
      onChanged(data.studyStep);
      setMoving(false);
      setPending(false);
      router.refresh();
    } catch {
      setError("Bağlantı hatası.");
      setPending(false);
    }
  }

  const detailHref = readOnly
    ? `/veli/plan/adim/${snapshot.id}`
    : `/cocuk/plan/adim/${snapshot.id}`;

  if (readOnly) {
    return (
      <Link
        href={detailHref}
        className="block rounded-2xl border px-3 py-3 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
        style={{
          borderColor: "var(--line)",
          background: "white",
          outlineColor: "var(--accent)",
        }}
      >
        <StudyStatusBadge
          status={snapshot.status}
          plannedDate={snapshot.plannedDate}
          today={today}
        />
        <p className="mt-2 font-medium">{snapshot.title}</p>
        <p className="mt-1 text-sm" style={{ color: "var(--muted)" }}>
          {studyStepMeta(snapshot)}
          {snapshot.relatedDeadline
            ? ` · son: ${formatDayLabelTr(snapshot.relatedDeadline)}`
            : ""}
        </p>
      </Link>
    );
  }

  return (
    <article
      className="rounded-2xl border px-3 py-3"
      style={{ borderColor: "var(--line)", background: "white" }}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <StudyStatusBadge
            status={snapshot.status}
            plannedDate={snapshot.plannedDate}
            today={today}
          />
          <p className="mt-2 font-medium">{snapshot.title}</p>
          <p className="mt-1 text-sm" style={{ color: "var(--muted)" }}>
            {studyStepMeta(snapshot)}
          </p>
          {snapshot.relatedCommitmentTitle ? (
            <p className="mt-1 text-sm" style={{ color: "var(--muted)" }}>
              {snapshot.relatedCommitmentTitle}
              {snapshot.relatedDeadline
                ? ` · ${formatDayLabelTr(snapshot.relatedDeadline)}`
                : ""}
            </p>
          ) : null}
        </div>
        <div className="relative shrink-0">
          <button
            type="button"
            className="min-h-11 min-w-11 rounded-2xl border px-2 text-sm font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
            style={{ borderColor: "var(--line)", outlineColor: "var(--accent)" }}
            aria-expanded={menuOpen}
            aria-haspopup="menu"
            onClick={() => setMenuOpen((v) => !v)}
          >
            ···
          </button>
          {menuOpen ? (
            <div
              role="menu"
              className="absolute right-0 z-10 mt-1 min-w-[10rem] rounded-2xl border bg-white p-2 shadow"
              style={{ borderColor: "var(--line)" }}
            >
              <Link
                href={detailHref}
                className="block min-h-11 px-2 py-2 text-sm font-semibold"
                role="menuitem"
              >
                Düzenle
              </Link>
              <button
                type="button"
                className="block min-h-11 w-full px-2 py-2 text-left text-sm font-semibold"
                role="menuitem"
                onClick={() => {
                  setMenuOpen(false);
                  setMoving(true);
                }}
              >
                Başka güne taşı
              </button>
            </div>
          ) : null}
        </div>
      </div>

      {!moving ? (
        <div className="mt-3 flex flex-col gap-2">
          {snapshot.status === "TODO" ? (
            <Button type="button" disabled={pending} onClick={() => void setStatus("IN_PROGRESS")}>
              Başla
            </Button>
          ) : null}
          {snapshot.status !== "DONE" ? (
            <Button
              type="button"
              variant="secondary"
              disabled={pending}
              onClick={() => void setStatus("DONE")}
            >
              Tamamladım
            </Button>
          ) : null}
          {snapshot.status !== "TODO" ? (
            <Button
              type="button"
              variant="ghost"
              disabled={pending}
              onClick={() => void setStatus("TODO")}
            >
              Yapılacaklara al
            </Button>
          ) : null}
        </div>
      ) : (
        <div className="mt-3 space-y-2">
          <label className="block text-sm font-semibold" htmlFor={`move-${snapshot.id}`}>
            Yeni gün
          </label>
          <input
            id={`move-${snapshot.id}`}
            type="date"
            className="min-h-12 w-full rounded-2xl border px-4"
            style={{ borderColor: "var(--line)", background: "white" }}
            value={moveDate}
            onChange={(e) => setMoveDate(e.target.value)}
          />
          <Button type="button" disabled={pending} onClick={() => void reschedule()}>
            Taşı
          </Button>
          <Button type="button" variant="ghost" disabled={pending} onClick={() => setMoving(false)}>
            Vazgeç
          </Button>
        </div>
      )}

      <FieldError message={error} />
    </article>
  );
}

export function BoardPlanView({
  week,
  readOnly = false,
}: {
  week: PlanningWeek;
  readOnly?: boolean;
}) {
  const router = useRouter();
  const boardRef = useRef<HTMLDivElement>(null);
  const weekSteps = useMemo(
    () => week.days.flatMap((d) => d.studySteps),
    [week.days],
  );
  const [steps, setSteps] = useState(weekSteps);
  const [tab, setTab] = useState<StudyStepStatus>("TODO");
  const [useTabs, setUseTabs] = useState(true);
  const [reflectionStepId, setReflectionStepId] = useState<string | null>(null);

  useEffect(() => {
    setSteps(weekSteps);
  }, [weekSteps]);

  useEffect(() => {
    const el = boardRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width ?? 0;
      setUseTabs(width < BOARD_THREE_COL_MIN);
    });
    ro.observe(el);
    setUseTabs(el.clientWidth < BOARD_THREE_COL_MIN);
    return () => ro.disconnect();
  }, []);

  function onChanged(next: StudyStepView, opts?: { offerReflection?: boolean }) {
    setSteps((prev) => {
      const exists = prev.some((s) => s.id === next.id);
      if (exists) return prev.map((s) => (s.id === next.id ? next : s));
      return prev;
    });
    if (opts?.offerReflection && next.status === "DONE") {
      setReflectionStepId(next.id);
      setTab("DONE");
    }
    if (next.status !== "DONE" && reflectionStepId === next.id) {
      setReflectionStepId(null);
    }
  }

  const reflectionStep = reflectionStepId
    ? steps.find((s) => s.id === reflectionStepId)
    : undefined;

  const byStatus = (status: StudyStepStatus) => steps.filter((s) => s.status === status);

  const weekCommitments = week.days.flatMap((d) =>
    d.commitments
      .filter((c) => !c.completedAt)
      .map((c) => ({ ...c, day: d.date })),
  );

  function renderColumn(status: StudyStepStatus) {
    const list = byStatus(status);
    return (
      <section aria-label={studyStepStatusLabel(status)} className="space-y-2">
        <h3 className="text-sm font-semibold">
          {studyStepStatusLabel(status)}{" "}
          <span style={{ color: "var(--muted)" }}>({list.length})</span>
        </h3>
        {list.length === 0 ? (
          <p className="text-sm" style={{ color: "var(--muted)" }}>
            Bu sütunda adım yok.
          </p>
        ) : (
          <ul className="space-y-2">
            {list.map((s) => (
              <li key={s.id}>
                <StepCard
                  step={s}
                  readOnly={readOnly}
                  today={week.today}
                  onChanged={onChanged}
                />
              </li>
            ))}
          </ul>
        )}
      </section>
    );
  }

  return (
    <div className="space-y-5" ref={boardRef}>
      <WeekNav week={week} view="pano" readOnly={readOnly} />

      {weekCommitments.length > 0 ? (
        <section>
          <h3 className="text-sm font-semibold">
            Bu haftanın sınavları ve etkinlikleri
          </h3>
          <ul className="mt-2 space-y-2">
            {weekCommitments.map((c) => {
              const href = readOnly
                ? `/veli/plan/is/${c.id}`
                : `/cocuk/plan/is/${c.id}`;
              return (
                <li key={c.id}>
                  <Link
                    href={href}
                    className="block rounded-2xl border px-3 py-3 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
                    style={{
                      borderColor: "var(--line)",
                      background: "rgba(15, 118, 110, 0.06)",
                      outlineColor: "var(--accent)",
                    }}
                  >
                    <span className="font-semibold">{commitmentTypeLabel(c.type)}</span>
                    {" · "}
                    {c.title}
                    <span className="mt-1 block" style={{ color: "var(--muted)" }}>
                      {commitmentDateLabel(c)}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      {!useTabs ? (
        <div className="grid gap-4" style={{ gridTemplateColumns: "repeat(3, minmax(0, 1fr))" }}>
          {COLUMNS.map((status) => (
            <div key={status}>{renderColumn(status)}</div>
          ))}
        </div>
      ) : (
        <div>
          <div className="grid grid-cols-3 gap-1" role="tablist" aria-label="Pano sütunları">
            {COLUMNS.map((status) => {
              const count = byStatus(status).length;
              const selected = tab === status;
              return (
                <button
                  key={status}
                  type="button"
                  role="tab"
                  aria-selected={selected}
                  className="min-h-12 rounded-2xl px-2 text-xs font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
                  style={{
                    border: selected ? "2px solid var(--accent)" : "1px solid var(--line)",
                    background: selected ? "var(--accent-soft)" : "white",
                    outlineColor: "var(--accent)",
                  }}
                  onClick={() => setTab(status)}
                >
                  {studyStepStatusLabel(status)}
                  <span className="mt-1 block" style={{ color: "var(--muted)" }}>
                    {count}
                  </span>
                </button>
              );
            })}
          </div>
          <div className="mt-4" role="tabpanel">
            {renderColumn(tab)}
          </div>
        </div>
      )}

      {reflectionStep && !readOnly ? (
        <CompletionReflectionPrompt
          step={reflectionStep}
          onUpdated={(next) => onChanged(next)}
          onDismiss={() => setReflectionStepId(null)}
        />
      ) : null}

      {steps.length === 0 ? (
        <p className="text-sm" style={{ color: "var(--muted)" }}>
          Bu hafta için planlanmış çalışma adımı yok.
          {!readOnly ? (
            <>
              {" "}
              <Link href="/cocuk/plan/yeni" className="font-semibold underline">
                Plan ekle
              </Link>
            </>
          ) : null}
        </p>
      ) : null}

      {week.unscheduled.length > 0 ? (
        <section>
          <h3 className="text-sm font-semibold">Günü seçilmemiş</h3>
          <ul className="mt-2 space-y-2">
            {week.unscheduled.map((s) => (
              <li key={s.id}>
                <StepCard
                  step={s}
                  readOnly={readOnly}
                  today={week.today}
                  onChanged={() => router.refresh()}
                />
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {week.missed.length > 0 ? (
        <section>
          <h3 className="text-sm font-semibold">Kaçırılan açık adımlar</h3>
          <ul className="mt-2 space-y-2">
            {week.missed.map((s) => (
              <li key={s.id}>
                <StepCard
                  step={s}
                  readOnly={readOnly}
                  today={week.today}
                  onChanged={() => router.refresh()}
                />
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
