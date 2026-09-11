"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { WeekNav, type PlanningWeek } from "@/components/board-plan-view";
import {
  commitmentDateLabel,
  commitmentTypeLabel,
  studyStepMeta,
  studyStepStatusLabel,
} from "@/lib/plan-ui";
import { formatLongDateTr } from "@/lib/plan-dates";

const WEEKDAY_SHORT = ["Pzt", "Sal", "Çar", "Per", "Cum", "Cmt", "Paz"];

export function WeekPlanView({
  week,
  initialSelectedDate,
  readOnly = false,
}: {
  week: PlanningWeek;
  initialSelectedDate?: string;
  readOnly?: boolean;
}) {
  const defaultDay =
    initialSelectedDate && week.days.some((d) => d.date === initialSelectedDate)
      ? initialSelectedDate
      : week.days.find((d) => d.date === week.today)?.date || week.weekStart;
  const [selected, setSelected] = useState(defaultDay);

  const day = useMemo(
    () => week.days.find((d) => d.date === selected) || week.days[0]!,
    [week.days, selected],
  );

  return (
    <div className="space-y-4">
      <WeekNav week={week} view="hafta" readOnly={readOnly} />

      <div className="grid grid-cols-7 gap-1">
        {week.days.map((d, i) => {
          const isSelected = d.date === selected;
          const isToday = d.date === week.today;
          return (
            <button
              key={d.date}
              type="button"
              onClick={() => setSelected(d.date)}
              className="flex min-h-[4.5rem] flex-col items-center justify-center rounded-2xl px-1 py-2 text-center text-xs"
              style={{
                border: isSelected ? "2px solid var(--accent)" : "1px solid var(--line)",
                background: isToday ? "var(--accent-soft)" : "white",
              }}
              aria-pressed={isSelected}
            >
              <span className="font-semibold">{WEEKDAY_SHORT[i]}</span>
              <span>{d.date.slice(8)}</span>
              <span style={{ color: "var(--muted)" }}>
                {d.studyStepCount > 0 ? `${d.studyStepCount} adım` : "—"}
              </span>
              {d.studyMinutes > 0 ? (
                <span style={{ color: "var(--muted)" }}>~{d.studyMinutes} dk</span>
              ) : null}
            </button>
          );
        })}
      </div>

      <section>
        <h2 className="text-lg font-semibold">{formatLongDateTr(day.date)}</h2>

        <h3 className="mt-4 text-sm font-semibold" style={{ color: "var(--muted)" }}>
          Teslim / etkinlik
        </h3>
        {day.commitments.length === 0 ? (
          <p className="mt-2 text-sm" style={{ color: "var(--muted)" }}>
            Bu günde ödev, sınav veya etkinlik yok.
          </p>
        ) : (
          <ul className="mt-2 space-y-2">
            {day.commitments.map((c) => (
              <li key={c.id}>
                {readOnly ? (
                  <div
                    className="rounded-2xl border px-3 py-3"
                    style={{
                      borderColor: "var(--line)",
                      background: "rgba(15, 118, 110, 0.06)",
                    }}
                  >
                    <p className="text-xs font-semibold uppercase tracking-wide">
                      {commitmentTypeLabel(c.type)}
                      {c.completedAt ? " · tamamlandı" : ""}
                    </p>
                    <p className="font-medium">{c.title}</p>
                    <p className="text-sm" style={{ color: "var(--muted)" }}>
                      {commitmentDateLabel(c)}
                      {c.subject ? ` · ${c.subject}` : ""}
                    </p>
                  </div>
                ) : (
                  <Link
                    href={`/cocuk/plan/is/${c.id}`}
                    className="block rounded-2xl border px-3 py-3"
                    style={{
                      borderColor: "var(--line)",
                      background: "rgba(15, 118, 110, 0.06)",
                    }}
                  >
                    <p className="text-xs font-semibold uppercase tracking-wide">
                      {commitmentTypeLabel(c.type)}
                      {c.completedAt ? " · tamamlandı" : ""}
                    </p>
                    <p className="font-medium">{c.title}</p>
                    <p className="text-sm" style={{ color: "var(--muted)" }}>
                      {commitmentDateLabel(c)}
                      {c.subject ? ` · ${c.subject}` : ""}
                    </p>
                  </Link>
                )}
              </li>
            ))}
          </ul>
        )}

        <h3 className="mt-5 text-sm font-semibold" style={{ color: "var(--muted)" }}>
          Çalışma adımları
        </h3>
        {day.studySteps.length === 0 ? (
          <p className="mt-2 text-sm" style={{ color: "var(--muted)" }}>
            Bu güne planlanmış adım yok.
            {!readOnly ? (
              <>
                {" "}
                <Link href="/cocuk/plan/yeni" className="font-semibold underline">
                  Plan ekle
                </Link>
              </>
            ) : null}
          </p>
        ) : (
          <ul className="mt-2 space-y-2">
            {day.studySteps.map((s) => (
              <li key={s.id}>
                {readOnly ? (
                  <div
                    className="rounded-2xl border px-3 py-3"
                    style={{ borderColor: "var(--line)" }}
                  >
                    <p className="text-xs font-semibold" style={{ color: "var(--muted)" }}>
                      {studyStepStatusLabel(s.status)}
                    </p>
                    <p className="font-medium">{s.title}</p>
                    <p className="text-sm" style={{ color: "var(--muted)" }}>
                      {studyStepMeta(s)}
                    </p>
                  </div>
                ) : (
                  <Link
                    href={`/cocuk/plan/adim/${s.id}`}
                    className="block rounded-2xl border px-3 py-3"
                    style={{ borderColor: "var(--line)" }}
                  >
                    <p className="text-xs font-semibold" style={{ color: "var(--muted)" }}>
                      {studyStepStatusLabel(s.status)}
                    </p>
                    <p className="font-medium">{s.title}</p>
                    <p className="text-sm" style={{ color: "var(--muted)" }}>
                      {studyStepMeta(s)}
                    </p>
                  </Link>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {week.unscheduled.length > 0 ? (
        <section>
          <h3 className="text-sm font-semibold">Günü seçilmemiş</h3>
          <ul className="mt-2 space-y-2">
            {week.unscheduled.map((s) => (
              <li key={s.id}>
                {readOnly ? (
                  <div
                    className="rounded-2xl border border-dashed px-3 py-3"
                    style={{ borderColor: "var(--line)" }}
                  >
                    <p className="font-medium">{s.title}</p>
                    <p className="text-sm" style={{ color: "var(--muted)" }}>
                      {studyStepStatusLabel(s.status)} · {studyStepMeta(s)}
                    </p>
                  </div>
                ) : (
                  <Link
                    href={`/cocuk/plan/adim/${s.id}`}
                    className="block rounded-2xl border border-dashed px-3 py-3"
                    style={{ borderColor: "var(--line)" }}
                  >
                    <p className="font-medium">{s.title}</p>
                    <p className="text-sm" style={{ color: "var(--muted)" }}>
                      {studyStepStatusLabel(s.status)} · {studyStepMeta(s)}
                    </p>
                  </Link>
                )}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {week.missed.length > 0 ? (
        <section>
          <h3 className="text-sm font-semibold">Önceki günlerden kalanlar</h3>
          <ul className="mt-2 space-y-2">
            {week.missed
              .filter((s) => s.plannedDate !== selected)
              .map((s) => (
                <li key={s.id}>
                  {readOnly ? (
                    <div
                      className="rounded-2xl border px-3 py-3"
                      style={{ borderColor: "var(--line)" }}
                    >
                      <p className="font-medium">{s.title}</p>
                      <p className="text-sm" style={{ color: "var(--muted)" }}>
                        {studyStepStatusLabel(s.status)} · {studyStepMeta(s)}
                      </p>
                    </div>
                  ) : (
                    <Link
                      href={`/cocuk/plan/adim/${s.id}`}
                      className="block rounded-2xl border px-3 py-3"
                      style={{ borderColor: "var(--line)" }}
                    >
                      <p className="font-medium">{s.title}</p>
                      <p className="text-sm" style={{ color: "var(--muted)" }}>
                        {studyStepStatusLabel(s.status)} · {studyStepMeta(s)}
                      </p>
                    </Link>
                  )}
                </li>
              ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
