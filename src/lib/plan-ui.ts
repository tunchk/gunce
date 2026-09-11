import type { PlanCommitmentType } from "@prisma/client";
import type { CommitmentView, StudyStepStatus, StudyStepView } from "@/lib/plan";
import { formatDayLabelTr, formatLongDateTr } from "@/lib/plan-dates";

export function commitmentTypeLabel(type: PlanCommitmentType): string {
  switch (type) {
    case "HOMEWORK":
      return "Ödev";
    case "EXAM":
      return "Sınav";
    case "COURSE":
      return "Kurs / etkinlik";
    default:
      return "İş";
  }
}

export function studyStepStatusLabel(status: StudyStepStatus): string {
  switch (status) {
    case "TODO":
      return "Yapılacak";
    case "IN_PROGRESS":
      return "Yapıyorum";
    case "DONE":
      return "Tamamladım";
    default:
      return status;
  }
}

export function goalLifecycleLabel(status: "ACTIVE" | "ACHIEVED" | "ARCHIVED"): string {
  switch (status) {
    case "ACTIVE":
      return "Devam ediyor";
    case "ACHIEVED":
      return "Ulaşıldı";
    case "ARCHIVED":
      return "Arşiv";
    default:
      return status;
  }
}

export function commitmentDateLabel(c: CommitmentView): string {
  if (c.type === "HOMEWORK") {
    if (!c.dueDate) return "Teslim tarihi belli değil";
    return `Teslim: ${formatLongDateTr(c.dueDate)}`;
  }
  const date = c.eventDate ? formatLongDateTr(c.eventDate) : "Tarih yok";
  if (c.eventTimeLocal) return `${date}, ${c.eventTimeLocal}`;
  return date;
}

export function studyStepMeta(s: StudyStepView): string {
  const parts: string[] = [];
  if (s.plannedDate) parts.push(formatDayLabelTr(s.plannedDate));
  else parts.push("Günü seçilmedi");
  if (s.estimatedMinutes) parts.push(`~${s.estimatedMinutes} dk`);
  if (s.relatedCommitmentTitle) parts.push(s.relatedCommitmentTitle);
  return parts.join(" · ");
}

export function newClientRequestId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `req_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}
