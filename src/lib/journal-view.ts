/** Client-safe journal view helpers (no next/headers / Prisma). */

export function formatDiaryDate(date: Date): string {
  return new Intl.DateTimeFormat("tr-TR", {
    timeZone: "UTC",
    year: "numeric",
    month: "long",
    day: "numeric",
    weekday: "long",
  }).format(date);
}

export function excerptSharedText(text: string, max = 140): string {
  const trimmed = text.trim();
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, max - 1).trimEnd()}…`;
}

export type ParentSharedItem = {
  shareId: string;
  entryId: string;
  childId: string;
  childDisplayName: string;
  diaryDate: string;
  publishedAt: string;
  parentMessage: string;
  supportRequest: string;
  snapshotRevision: number;
  kind: "message" | "support" | "both";
  guidanceOpener: string | null;
};
