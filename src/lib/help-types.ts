import type {
  HelpOfferStatus,
  HelpRequestStatus,
  HelpType,
  PlanCommitmentType,
} from "@prisma/client";

export type HelpPlanItemView = {
  kind: "study_step" | "commitment";
  id: string;
  title: string;
  subject: string;
  type?: PlanCommitmentType;
  date: string | null;
};

export type HelpOfferView = {
  id: string;
  requestId: string;
  guardianUserId: string;
  guardianName: string;
  proposedDate: string;
  proposedTimeLocal: string;
  note: string;
  status: HelpOfferStatus;
  createdAt: string;
};

export type HelpRequestView = {
  id: string;
  childId: string;
  childDisplayName: string;
  helpType: HelpType;
  helpTypeLabel: string;
  note: string;
  status: HelpRequestStatus;
  statusLabel: string;
  planItem: HelpPlanItemView;
  acceptedOfferId: string | null;
  cancelledAt: string | null;
  completedAt: string | null;
  createdAt: string;
  offers: HelpOfferView[];
  /** Soft UX hint when a prior accepted session was reopened. */
  lifecycleNotice: string | null;
};

export type HelpSessionView = {
  requestId: string;
  offerId: string;
  childId: string;
  childDisplayName: string;
  guardianUserId: string;
  guardianName: string;
  helpType: HelpType;
  helpTypeLabel: string;
  planItem: HelpPlanItemView;
  proposedDate: string;
  proposedTimeLocal: string;
  status: "ACCEPTED" | "COMPLETED" | "CANCELLED";
};
