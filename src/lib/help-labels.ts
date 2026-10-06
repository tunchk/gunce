import type { HelpRequestStatus, HelpType } from "@prisma/client";

export const HELP_TYPES = [
  "DO_TOGETHER",
  "EXPLAIN",
  "REVIEW",
  "OTHER",
] as const satisfies readonly HelpType[];

export function helpTypeLabel(type: HelpType): string {
  switch (type) {
    case "DO_TOGETHER":
      return "Birlikte yapalım";
    case "EXPLAIN":
      return "Bana anlatır mısın?";
    case "REVIEW":
      return "Kontrol eder misin?";
    case "OTHER":
      return "Başka";
    default:
      return type;
  }
}

export function helpRequestStatusLabel(status: HelpRequestStatus): string {
  switch (status) {
    case "OPEN":
      return "Yardım istedin";
    case "OFFERED":
      return "Teklif geldi";
    case "ACCEPTED":
      return "Yardım planlandı";
    case "COMPLETED":
      return "Tamamlandı";
    case "CANCELLED":
      return "İptal";
    default:
      return status;
  }
}
