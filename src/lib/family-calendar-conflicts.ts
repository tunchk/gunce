/**
 * Basic possible-conflict detection for family coordination calendar.
 * Informational only — never blocks saves.
 */

export type TimedSlot = {
  id: string;
  date: string;
  startTimeLocal: string | null;
  endTimeLocal: string | null;
};

function timeToMinutes(hhmm: string): number | null {
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(hhmm)) return null;
  const [h, m] = hhmm.split(":").map(Number);
  return h! * 60 + m!;
}

type Resolved =
  | { kind: "date_only" }
  | { kind: "point"; at: number }
  | { kind: "interval"; start: number; end: number };

function resolve(slot: TimedSlot): Resolved {
  const start = slot.startTimeLocal ? timeToMinutes(slot.startTimeLocal) : null;
  const end = slot.endTimeLocal ? timeToMinutes(slot.endTimeLocal) : null;
  if (start != null && end != null && end > start) {
    return { kind: "interval", start, end };
  }
  if (start != null) {
    return { kind: "point", at: start };
  }
  return { kind: "date_only" };
}

function pairConflicts(a: Resolved, b: Resolved): boolean {
  if (a.kind === "date_only" || b.kind === "date_only") return false;

  if (a.kind === "interval" && b.kind === "interval") {
    return a.start < b.end && b.start < a.end;
  }
  if (a.kind === "point" && b.kind === "interval") {
    return a.at >= b.start && a.at < b.end;
  }
  if (a.kind === "interval" && b.kind === "point") {
    return b.at >= a.start && b.at < a.end;
  }
  if (a.kind === "point" && b.kind === "point") {
    return a.at === b.at;
  }
  return false;
}

/** Returns ids that participate in at least one possible conflict on their date. */
export function detectPossibleConflictIds(slots: TimedSlot[]): Set<string> {
  const byDate = new Map<string, TimedSlot[]>();
  for (const slot of slots) {
    const list = byDate.get(slot.date) ?? [];
    list.push(slot);
    byDate.set(slot.date, list);
  }

  const flagged = new Set<string>();
  for (const daySlots of byDate.values()) {
    const resolved = daySlots.map((s) => ({ id: s.id, r: resolve(s) }));
    for (let i = 0; i < resolved.length; i++) {
      for (let j = i + 1; j < resolved.length; j++) {
        if (pairConflicts(resolved[i]!.r, resolved[j]!.r)) {
          flagged.add(resolved[i]!.id);
          flagged.add(resolved[j]!.id);
        }
      }
    }
  }
  return flagged;
}

/** Exported for unit-style integration tests. */
export function slotsPossiblyConflict(a: TimedSlot, b: TimedSlot): boolean {
  if (a.date !== b.date) return false;
  return pairConflicts(resolve(a), resolve(b));
}
