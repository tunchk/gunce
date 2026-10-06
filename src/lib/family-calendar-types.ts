import type { FamilyEventType } from "@prisma/client";

export type FamilyCalendarKind =
  | "STUDY_STEP"
  | "COMMITMENT"
  | "HELP_SESSION"
  | "FAMILY_EVENT";

export type FamilyCalendarItem = {
  id: string;
  kind: FamilyCalendarKind;
  kindLabel: string;
  date: string;
  startTimeLocal: string | null;
  endTimeLocal: string | null;
  title: string;
  status: string;
  statusLabel: string;
  href: string;
  sourceId: string;
  note: string | null;
  createdByUserId: string | null;
  createdByName: string | null;
  canEdit: boolean;
  canCancel: boolean;
  helpTypeLabel: string | null;
  guardianName: string | null;
  possibleConflict: boolean;
  conflictHint: string | null;
};

export type FamilyCoordinationDay = {
  date: string;
  items: FamilyCalendarItem[];
};

export type FamilyCoordinationWeek = {
  childId: string;
  childDisplayName: string;
  timeZone: string;
  today: string;
  weekStart: string;
  weekEnd: string;
  days: FamilyCoordinationDay[];
  /** Count of active family events in the week (excludes plan/help). */
  familyEventCount: number;
};

export type FamilyEventView = {
  id: string;
  childId: string;
  createdByUserId: string;
  createdByName: string;
  title: string;
  eventDate: string;
  startTimeLocal: string | null;
  endTimeLocal: string | null;
  eventType: FamilyEventType;
  eventTypeLabel: string;
  note: string;
  cancelledAt: string | null;
  createdAt: string;
  canEdit: boolean;
  canCancel: boolean;
};

export const FAMILY_EVENT_TYPES: FamilyEventType[] = [
  "SCHOOL",
  "APPOINTMENT",
  "FAMILY",
  "ACTIVITY",
  "OTHER",
];
