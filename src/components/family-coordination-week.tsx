import Link from "next/link";
import { addCalendarDays, formatDayLabelTr, formatLongDateTr } from "@/lib/plan-dates";
import type { FamilyCalendarItem, FamilyCoordinationWeek } from "@/lib/family-calendar-types";

function kindAccent(kind: FamilyCalendarItem["kind"]): string {
  switch (kind) {
    case "HELP_SESSION":
      return "rgba(180, 83, 9, 0.1)";
    case "FAMILY_EVENT":
      return "rgba(37, 99, 235, 0.08)";
    case "COMMITMENT":
      return "rgba(15, 118, 110, 0.06)";
    default:
      return "white";
  }
}

function timeLabel(item: FamilyCalendarItem): string {
  if (item.startTimeLocal && item.endTimeLocal) {
    return `${item.startTimeLocal}–${item.endTimeLocal}`;
  }
  if (item.startTimeLocal) return item.startTimeLocal;
  return "Tarih";
}

export function FamilyCoordinationWeekView({
  week,
  basePath,
  emptyFamilyCopy,
}: {
  week: FamilyCoordinationWeek;
  basePath: "/cocuk/haftam" | "/veli/takvim";
  emptyFamilyCopy: string;
}) {
  const prev = addCalendarDays(week.weekStart, -7);
  const next = addCalendarDays(week.weekStart, 7);
  const hasAny = week.days.some((d) => d.items.length > 0);
  const weekQuery =
    basePath === "/cocuk/haftam"
      ? (ws: string) => `${basePath}?view=aile&weekStart=${ws}`
      : (ws: string) => `${basePath}?weekStart=${ws}`;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Link
          href={weekQuery(prev)}
          className="inline-flex min-h-11 items-center rounded-2xl px-3 text-sm font-semibold"
          style={{ border: "1px solid var(--line)" }}
        >
          Önceki hafta
        </Link>
        <p className="text-sm font-semibold">
          {formatDayLabelTr(week.weekStart)} – {formatDayLabelTr(week.weekEnd)}
        </p>
        <Link
          href={weekQuery(next)}
          className="inline-flex min-h-11 items-center rounded-2xl px-3 text-sm font-semibold"
          style={{ border: "1px solid var(--line)" }}
        >
          Sonraki hafta
        </Link>
      </div>

      {!hasAny ? (
        <p className="text-sm leading-relaxed" style={{ color: "var(--muted)" }}>
          Bu hafta için listelenecek plan veya aile etkinliği yok.
        </p>
      ) : null}

      {week.familyEventCount === 0 ? (
        <p className="text-sm leading-relaxed" style={{ color: "var(--muted)" }}>
          {emptyFamilyCopy}
        </p>
      ) : null}

      <div className="space-y-5">
        {week.days.map((day) => (
          <section key={day.date}>
            <h3 className="text-base font-semibold">
              {formatLongDateTr(day.date)}
              {day.date === week.today ? (
                <span className="ml-2 text-xs font-semibold" style={{ color: "var(--accent)" }}>
                  Bugün
                </span>
              ) : null}
            </h3>
            {day.items.length === 0 ? (
              <p className="mt-2 text-sm" style={{ color: "var(--muted)" }}>
                —
              </p>
            ) : (
              <ul className="mt-2 space-y-2">
                {day.items.map((item) => (
                  <li key={item.id}>
                    <Link
                      href={item.href}
                      className="block rounded-2xl border px-3 py-3"
                      style={{
                        borderColor: "var(--line)",
                        background: kindAccent(item.kind),
                      }}
                      data-testid={`cal-item-${item.kind}`}
                    >
                      <div className="flex flex-wrap items-center gap-2 text-xs font-semibold uppercase tracking-wide">
                        <span>{item.kindLabel}</span>
                        <span style={{ color: "var(--muted)" }}>{timeLabel(item)}</span>
                        {item.possibleConflict ? (
                          <span
                            className="rounded-full px-2 py-0.5 normal-case"
                            style={{ background: "var(--accent-soft)", color: "var(--ink)" }}
                            data-testid="possible-conflict"
                          >
                            Olası çakışma
                          </span>
                        ) : null}
                      </div>
                      <p className="mt-1 text-sm font-semibold leading-relaxed">{item.title}</p>
                      {item.helpTypeLabel || item.guardianName ? (
                        <p className="mt-1 text-sm" style={{ color: "var(--muted)" }}>
                          {[item.helpTypeLabel, item.guardianName].filter(Boolean).join(" · ")}
                        </p>
                      ) : null}
                      {item.createdByName && item.kind === "FAMILY_EVENT" ? (
                        <p className="mt-1 text-sm" style={{ color: "var(--muted)" }}>
                          {item.statusLabel} · {item.createdByName}
                        </p>
                      ) : null}
                      {item.possibleConflict && item.conflictHint ? (
                        <p className="mt-1 text-xs" style={{ color: "var(--muted)" }}>
                          {item.conflictHint}
                        </p>
                      ) : null}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
        ))}
      </div>
    </div>
  );
}
