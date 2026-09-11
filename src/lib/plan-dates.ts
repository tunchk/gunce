/**
 * Calendar-date helpers for planning.
 * Store/compare dates as UTC-midnight of the calendar day (YYYY-MM-DD),
 * never as local wall-clock instants that can shift across time zones.
 */

export function calendarDateInTimeZone(timeZone: string, at = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(at);
  const y = parts.find((p) => p.type === "year")?.value;
  const m = parts.find((p) => p.type === "month")?.value;
  const d = parts.find((p) => p.type === "day")?.value;
  if (!y || !m || !d) {
    throw new Error("Saat dilimi tarihi hesaplanamadı.");
  }
  return `${y}-${m}-${d}`;
}

/** Parse YYYY-MM-DD into a Date at UTC midnight for @db.Date storage. */
export function parseCalendarDate(value: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error("Geçersiz tarih.");
  }
  const d = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== value) {
    throw new Error("Geçersiz tarih.");
  }
  return d;
}

export function formatCalendarDate(date: Date | null | undefined): string | null {
  if (!date) return null;
  return date.toISOString().slice(0, 10);
}

export function addCalendarDays(isoDate: string, days: number): string {
  const d = parseCalendarDate(isoDate);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Monday (ISO) of the week containing isoDate. */
export function startOfWeekMonday(isoDate: string): string {
  const d = parseCalendarDate(isoDate);
  const day = d.getUTCDay(); // 0 Sun .. 6 Sat
  const offset = day === 0 ? -6 : 1 - day;
  return addCalendarDays(isoDate, offset);
}

export function weekDatesFromMonday(mondayIso: string): string[] {
  return Array.from({ length: 7 }, (_, i) => addCalendarDays(mondayIso, i));
}

export function compareCalendarDates(a: string, b: string): number {
  return a.localeCompare(b);
}

export function isValidEventTimeLocal(value: string): boolean {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

export function formatDayLabelTr(isoDate: string): string {
  const d = parseCalendarDate(isoDate);
  return new Intl.DateTimeFormat("tr-TR", {
    timeZone: "UTC",
    weekday: "short",
    day: "numeric",
    month: "short",
  }).format(d);
}

export function formatLongDateTr(isoDate: string): string {
  const d = parseCalendarDate(isoDate);
  return new Intl.DateTimeFormat("tr-TR", {
    timeZone: "UTC",
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(d);
}
