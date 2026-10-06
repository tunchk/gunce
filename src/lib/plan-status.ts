import type { StudyStepStatus } from "@/lib/plan";

export type StudyStatusPresentation = {
  label: string;
  tone: "neutral" | "progress" | "done" | "overdue";
  icon: "empty" | "progress" | "check";
  color: string;
  background: string;
};

/** Shared status mapping for child home, Hafta, Pano, goals, and parent views. */
export function studyStatusPresentation(
  status: StudyStepStatus,
): StudyStatusPresentation {
  switch (status) {
    case "IN_PROGRESS":
      return {
        label: "Yapıyorum",
        tone: "progress",
        icon: "progress",
        color: "#1d4ed8",
        background: "rgba(37, 99, 235, 0.12)",
      };
    case "DONE":
      return {
        label: "Tamamlandı",
        tone: "done",
        icon: "check",
        color: "#15803d",
        background: "rgba(22, 163, 74, 0.12)",
      };
    case "TODO":
    default:
      return {
        label: "Yapılacak",
        tone: "neutral",
        icon: "empty",
        color: "var(--muted)",
        background: "rgba(15, 23, 42, 0.04)",
      };
  }
}

export function studyStepStatusLabel(status: StudyStepStatus): string {
  return studyStatusPresentation(status).label;
}

export function isPlannedDateOverdue(
  plannedDate: string | null | undefined,
  status: StudyStepStatus,
  today: string,
): boolean {
  if (!plannedDate || status === "DONE") return false;
  return plannedDate < today;
}
