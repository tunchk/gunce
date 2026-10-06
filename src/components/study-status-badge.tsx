"use client";

import type { StudyStepStatus } from "@/lib/plan";
import {
  isPlannedDateOverdue,
  studyStatusPresentation,
} from "@/lib/plan-status";

function StatusIcon({ kind }: { kind: "empty" | "progress" | "check" }) {
  if (kind === "check") {
    return (
      <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden>
        <circle cx="8" cy="8" r="7" fill="currentColor" opacity="0.15" />
        <path
          d="M4.5 8.2 7 10.5 11.5 5.5"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    );
  }
  if (kind === "progress") {
    return (
      <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden>
        <circle
          cx="8"
          cy="8"
          r="6"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          opacity="0.35"
        />
        <path
          d="M8 2a6 6 0 0 1 6 6"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
        />
      </svg>
    );
  }
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden>
      <circle
        cx="8"
        cy="8"
        r="6"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
      />
    </svg>
  );
}

export function StudyStatusBadge({
  status,
  plannedDate,
  today,
}: {
  status: StudyStepStatus;
  plannedDate?: string | null;
  today?: string;
}) {
  const presentation = studyStatusPresentation(status);
  const overdue =
    today && plannedDate
      ? isPlannedDateOverdue(plannedDate, status, today)
      : false;

  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <span
        className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold"
        style={{
          color: presentation.color,
          background: presentation.background,
        }}
      >
        <StatusIcon kind={presentation.icon} />
        {presentation.label}
      </span>
      {overdue ? (
        <span
          className="inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold"
          style={{ color: "#b45309", background: "rgba(245, 158, 11, 0.16)" }}
        >
          Tarihi geçti
        </span>
      ) : null}
    </span>
  );
}
