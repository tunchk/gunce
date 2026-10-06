import type { FamilyEventType } from "@prisma/client";
import type { FamilyCalendarKind } from "@/lib/family-calendar-types";

export function familyEventTypeLabel(type: FamilyEventType): string {
  switch (type) {
    case "SCHOOL":
      return "Okul";
    case "APPOINTMENT":
      return "Randevu";
    case "FAMILY":
      return "Aile";
    case "ACTIVITY":
      return "Etkinlik";
    case "OTHER":
    default:
      return "Diğer";
  }
}

export function familyCalendarKindLabel(kind: FamilyCalendarKind): string {
  switch (kind) {
    case "STUDY_STEP":
      return "Ders";
    case "COMMITMENT":
      return "Ödev / sınav";
    case "HELP_SESSION":
      return "Yardım";
    case "FAMILY_EVENT":
      return "Aile";
    default:
      return "Plan";
  }
}
