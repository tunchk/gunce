import { addCalendarDays, parseCalendarDate } from "@/lib/plan-dates";

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

export function isValidLocalTime(value: string): boolean {
  return HHMM.test(value.trim());
}

export function parseLocalTimeParts(value: string): { hour: number; minute: number } {
  if (!isValidLocalTime(value)) throw new Error("Geçersiz saat.");
  const [h, m] = value.trim().split(":").map(Number);
  return { hour: h!, minute: m! };
}

export function formatLocalTime(hour: number, minute: number): string {
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

/** Minutes from local midnight. */
export function localTimeToMinutes(value: string): number {
  const { hour, minute } = parseLocalTimeParts(value);
  return hour * 60 + minute;
}

/**
 * Quiet hours may span midnight (e.g. 21:00–08:00).
 * Returns true when localMinutes is inside the quiet window.
 */
export function isInQuietHours(
  localMinutes: number,
  quietStart: string,
  quietEnd: string,
): boolean {
  const start = localTimeToMinutes(quietStart);
  const end = localTimeToMinutes(quietEnd);
  if (start === end) return false;
  if (start < end) {
    return localMinutes >= start && localMinutes < end;
  }
  return localMinutes >= start || localMinutes < end;
}

export function getZonedParts(at: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(at);
  const get = (type: string) => parts.find((p) => p.type === type)?.value;
  const y = get("year");
  const m = get("month");
  const d = get("day");
  const hour = Number(get("hour"));
  const minute = Number(get("minute"));
  if (!y || !m || !d || Number.isNaN(hour) || Number.isNaN(minute)) {
    throw new Error("Saat dilimi parçaları okunamadı.");
  }
  return { date: `${y}-${m}-${d}`, hour, minute, minutes: hour * 60 + minute };
}

/**
 * Convert child-local calendar date + HH:mm into a UTC Date.
 * DST gap → first valid local time after the gap (same or next day).
 * DST overlap → single occurrence (earliest UTC that maps to that wall time).
 */
export function zonedLocalDateTimeToUtc(input: {
  timeZone: string;
  localDate: string;
  localTime: string;
}): Date {
  parseCalendarDate(input.localDate);
  const { hour, minute } = parseLocalTimeParts(input.localTime);
  const [y, mo, d] = input.localDate.split("-").map(Number);
  const nominal = Date.UTC(y!, mo! - 1, d!, hour, minute, 0);

  const matches: number[] = [];
  for (let delta = -48 * 60; delta <= 48 * 60; delta++) {
    const t = nominal + delta * 60_000;
    const parts = getZonedParts(new Date(t), input.timeZone);
    if (parts.date === input.localDate && parts.hour === hour && parts.minute === minute) {
      matches.push(t);
    }
  }

  if (matches.length > 0) {
    matches.sort((a, b) => a - b);
    return new Date(matches[0]!);
  }

  // Gap: walk forward local minutes until a valid mapping exists (max 3h).
  for (let add = 1; add <= 180; add++) {
    const total = hour * 60 + minute + add;
    const dayAdd = Math.floor(total / (24 * 60));
    const rem = total % (24 * 60);
    const nextDate = addCalendarDays(input.localDate, dayAdd);
    const nextTime = formatLocalTime(Math.floor(rem / 60), rem % 60);
    const [ny, nmo, nd] = nextDate.split("-").map(Number);
    const nextNominal = Date.UTC(ny!, nmo! - 1, nd!, Math.floor(rem / 60), rem % 60, 0);
    for (let delta = -48 * 60; delta <= 48 * 60; delta++) {
      const t = nextNominal + delta * 60_000;
      const parts = getZonedParts(new Date(t), input.timeZone);
      if (
        parts.date === nextDate &&
        parts.hour === Math.floor(rem / 60) &&
        parts.minute === rem % 60
      ) {
        return new Date(t);
      }
    }
  }

  throw new Error("Yerel zaman UTC’ye çevrilemedi.");
}

/**
 * Spec: defer inside quiet hours to the next permitted time on the same local day;
 * otherwise skip that occurrence.
 */
export function applyQuietHoursPolicy(input: {
  localTime: string;
  quietStart: string;
  quietEnd: string;
}): { action: "ok" | "defer"; localTime: string } | { action: "skip" } {
  const mins = localTimeToMinutes(input.localTime);
  if (!isInQuietHours(mins, input.quietStart, input.quietEnd)) {
    return { action: "ok", localTime: input.localTime };
  }
  const startMins = localTimeToMinutes(input.quietStart);
  const endMins = localTimeToMinutes(input.quietEnd);

  if (startMins < endMins) {
    // e.g. 13:00–15:00 → defer to 15:00 same day
    return { action: "defer", localTime: formatLocalTime(Math.floor(endMins / 60), endMins % 60) };
  }

  // Spans midnight e.g. 21:00–08:00
  if (mins >= startMins) {
    // Evening quiet — next permitted is next calendar morning → skip same-day occurrence
    return { action: "skip" };
  }
  // Morning quiet before end → defer to quietEnd same day
  return { action: "defer", localTime: formatLocalTime(Math.floor(endMins / 60), endMins % 60) };
}

export function resolveDeliveryInstant(input: {
  timeZone: string;
  localDate: string;
  localTime: string;
  quietStart: string;
  quietEnd: string;
}): { scheduledAt: Date; localTimeUsed: string } | { skip: true } {
  const policy = applyQuietHoursPolicy({
    localTime: input.localTime,
    quietStart: input.quietStart,
    quietEnd: input.quietEnd,
  });
  if (policy.action === "skip") return { skip: true };
  return {
    scheduledAt: zonedLocalDateTimeToUtc({
      timeZone: input.timeZone,
      localDate: input.localDate,
      localTime: policy.localTime,
    }),
    localTimeUsed: policy.localTime,
  };
}
