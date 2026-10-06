import { describe, expect, it } from "vitest";
import {
  acceptGuardianInvitation,
  inviteGuardian,
  removeGuardianAccess,
} from "@/lib/guardian";
import {
  acceptHelpOffer,
  cancelAcceptedHelpByGuardian,
  cancelHelpRequest,
  createHelpOffer,
  createHelpRequest,
  editHelpOffer,
  getChildHelpRequest,
  getParentHelpRequest,
  HelpError,
  listChildHelpSessions,
  withdrawHelpOffer,
} from "@/lib/help";
import { createStudyStep, updateStudyStep } from "@/lib/plan";
import { listNotifications } from "@/lib/notifications";
import {
  createParent,
  onboardParentWithChild,
  pairChildAndGetCookie,
  prisma,
} from "./helpers";

async function verifyParentEmail(userId: string) {
  await prisma.user.update({
    where: { id: userId },
    data: { emailVerified: true },
  });
}

async function setupFamily() {
  const parent = await createParent({ email: `help_b1_p_${Date.now()}@example.com` });
  await verifyParentEmail(parent.user.id);
  const child = await onboardParentWithChild(parent.user.id);
  await pairChildAndGetCookie(parent.user.id, child.id);
  const childUserId = (
    await prisma.childProfile.findUniqueOrThrow({ where: { id: child.id } })
  ).userId!;
  return { parent, child, childUserId };
}

async function addSecondGuardian(
  managerUserId: string,
  childId: string,
  emailPrefix: string,
) {
  const second = await createParent({ email: `${emailPrefix}_${Date.now()}@example.com` });
  await verifyParentEmail(second.user.id);
  const { token } = await inviteGuardian({
    managerUserId,
    childId,
    email: second.email,
  });
  await acceptGuardianInvitation({
    token,
    acceptorUserId: second.user.id,
  });
  return second;
}

describe("M12B.1 help lifecycle hardening", () => {
  it("guardian edits pending offer; cannot edit accepted offer", async () => {
    const { parent, childUserId } = await setupFamily();
    const step = await createStudyStep({
      childUserId,
      title: "Düzenle test",
      plannedDate: "2026-10-20",
    });
    const req = await createHelpRequest({
      childUserId,
      studyStepId: step.id,
      helpType: "EXPLAIN",
    });
    const offer = await createHelpOffer({
      parentUserId: parent.user.id,
      requestId: req.id,
      proposedDate: "2026-10-20",
      proposedTimeLocal: "17:00",
    });

    const edited = await editHelpOffer({
      parentUserId: parent.user.id,
      offerId: offer.id,
      proposedDate: "2026-10-21",
      proposedTimeLocal: "19:30",
    });
    expect(edited.proposedDate).toBe("2026-10-21");
    expect(edited.proposedTimeLocal).toBe("19:30");

    const notes = await listNotifications({
      recipientUserId: childUserId,
      filter: "all",
      limit: 20,
    });
    expect(notes.items.some((n) => n.kind === "HELP_OFFER_UPDATED")).toBe(true);

    await acceptHelpOffer({
      childUserId,
      requestId: req.id,
      offerId: offer.id,
    });

    await expect(
      editHelpOffer({
        parentUserId: parent.user.id,
        offerId: offer.id,
        proposedDate: "2026-10-22",
        proposedTimeLocal: "12:00",
      }),
    ).rejects.toMatchObject({ code: "VALIDATION" });
  });

  it("withdraw last pending offer → OPEN; withdraw with sibling → OFFERED", async () => {
    const { parent, child, childUserId } = await setupFamily();
    const second = await addSecondGuardian(parent.user.id, child.id, "help_b1_g2");

    const step = await createStudyStep({
      childUserId,
      title: "Geri al test",
      plannedDate: "2026-10-22",
    });
    const req = await createHelpRequest({
      childUserId,
      studyStepId: step.id,
      helpType: "REVIEW",
    });

    const offer1 = await createHelpOffer({
      parentUserId: parent.user.id,
      requestId: req.id,
      proposedDate: "2026-10-22",
      proposedTimeLocal: "18:00",
    });
    const offer2 = await createHelpOffer({
      parentUserId: second.user.id,
      requestId: req.id,
      proposedDate: "2026-10-23",
      proposedTimeLocal: "17:00",
    });

    await withdrawHelpOffer({ parentUserId: parent.user.id, offerId: offer1.id });
    let view = await getChildHelpRequest(childUserId, req.id);
    expect(view.status).toBe("OFFERED");
    expect(view.offers.find((o) => o.id === offer1.id)?.status).toBe("WITHDRAWN");
    expect(view.lifecycleNotice).toBeNull();

    await expect(
      acceptHelpOffer({
        childUserId,
        requestId: req.id,
        offerId: offer1.id,
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    await withdrawHelpOffer({ parentUserId: second.user.id, offerId: offer2.id });
    view = await getChildHelpRequest(childUserId, req.id);
    expect(view.status).toBe("OPEN");

    const notes = await listNotifications({
      recipientUserId: childUserId,
      filter: "all",
      limit: 30,
    });
    expect(notes.items.filter((n) => n.kind === "HELP_OFFER_WITHDRAWN").length).toBe(2);
  });

  it("accepted guardian cancels; acceptedOfferId cleared; sibling pending selectable", async () => {
    const { parent, child, childUserId } = await setupFamily();
    const second = await addSecondGuardian(parent.user.id, child.id, "help_b1_cancel");

    const step = await createStudyStep({
      childUserId,
      title: "Gelemeyeceğim",
      plannedDate: "2026-10-24",
    });
    const req = await createHelpRequest({
      childUserId,
      studyStepId: step.id,
      helpType: "DO_TOGETHER",
    });
    const offer1 = await createHelpOffer({
      parentUserId: parent.user.id,
      requestId: req.id,
      proposedDate: "2026-10-24",
      proposedTimeLocal: "18:00",
    });
    const offer2 = await createHelpOffer({
      parentUserId: second.user.id,
      requestId: req.id,
      proposedDate: "2026-10-25",
      proposedTimeLocal: "16:00",
    });

    await acceptHelpOffer({
      childUserId,
      requestId: req.id,
      offerId: offer1.id,
    });

    // While ACCEPTED, sibling stays PENDING as fallback but cannot be selected.
    const whileAccepted = await getChildHelpRequest(childUserId, req.id);
    expect(whileAccepted.status).toBe("ACCEPTED");
    expect(whileAccepted.offers.find((o) => o.id === offer2.id)?.status).toBe("PENDING");
    await expect(
      acceptHelpOffer({
        childUserId,
        requestId: req.id,
        offerId: offer2.id,
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });

    const reopened = await cancelAcceptedHelpByGuardian({
      parentUserId: parent.user.id,
      requestId: req.id,
    });
    expect(reopened.status).toBe("OFFERED");
    expect(reopened.acceptedOfferId).toBeNull();
    expect(reopened.offers.find((o) => o.id === offer1.id)?.status).toBe("WITHDRAWN");
    expect(reopened.offers.find((o) => o.id === offer2.id)?.status).toBe("PENDING");
    expect(reopened.lifecycleNotice).toBeTruthy();

    const sessions = await listChildHelpSessions(childUserId);
    expect(sessions.some((s) => s.requestId === req.id)).toBe(false);

    const accepted2 = await acceptHelpOffer({
      childUserId,
      requestId: req.id,
      offerId: offer2.id,
    });
    expect(accepted2.status).toBe("ACCEPTED");
    expect(accepted2.acceptedOfferId).toBe(offer2.id);
    expect(accepted2.lifecycleNotice).toBeNull();

    const notes = await listNotifications({
      recipientUserId: childUserId,
      filter: "all",
      limit: 40,
    });
    expect(notes.items.some((n) => n.kind === "HELP_ACCEPTED_CANCELLED")).toBe(true);
    expect(JSON.stringify(notes)).not.toContain("completionReflection");
  });

  it("accepted guardian cancel with no sibling → OPEN", async () => {
    const { parent, childUserId } = await setupFamily();
    const step = await createStudyStep({
      childUserId,
      title: "Tek veli iptal",
      plannedDate: "2026-10-26",
    });
    const req = await createHelpRequest({
      childUserId,
      studyStepId: step.id,
      helpType: "OTHER",
    });
    const offer = await createHelpOffer({
      parentUserId: parent.user.id,
      requestId: req.id,
      proposedDate: "2026-10-26",
      proposedTimeLocal: "15:00",
    });
    await acceptHelpOffer({
      childUserId,
      requestId: req.id,
      offerId: offer.id,
    });

    const reopened = await cancelAcceptedHelpByGuardian({
      parentUserId: parent.user.id,
      requestId: req.id,
    });
    expect(reopened.status).toBe("OPEN");
    expect(reopened.acceptedOfferId).toBeNull();
  });

  it("revoked guardian cannot edit, withdraw, or cancel accepted", async () => {
    const { parent, child, childUserId } = await setupFamily();
    const second = await addSecondGuardian(parent.user.id, child.id, "help_b1_rev");

    const step = await createStudyStep({ childUserId, title: "Revoke lifecycle" });
    const req = await createHelpRequest({
      childUserId,
      studyStepId: step.id,
      helpType: "EXPLAIN",
    });
    const offer = await createHelpOffer({
      parentUserId: second.user.id,
      requestId: req.id,
      proposedDate: "2026-10-27",
      proposedTimeLocal: "19:00",
    });

    await removeGuardianAccess({
      managerUserId: parent.user.id,
      childId: child.id,
      targetUserId: second.user.id,
    });

    await expect(
      editHelpOffer({
        parentUserId: second.user.id,
        offerId: offer.id,
        proposedDate: "2026-10-28",
        proposedTimeLocal: "20:00",
      }),
    ).rejects.toBeInstanceOf(HelpError);

    await expect(
      withdrawHelpOffer({ parentUserId: second.user.id, offerId: offer.id }),
    ).rejects.toBeInstanceOf(HelpError);

    // Re-grant path: create new request accepted then revoke before cancel
    const step2 = await createStudyStep({ childUserId, title: "Revoke accepted" });
    const req2 = await createHelpRequest({
      childUserId,
      studyStepId: step2.id,
      helpType: "REVIEW",
    });
    // Parent offers and child accepts; second tries cancel_accepted → fail closed
    const offerP = await createHelpOffer({
      parentUserId: parent.user.id,
      requestId: req2.id,
      proposedDate: "2026-10-28",
      proposedTimeLocal: "18:00",
    });
    await acceptHelpOffer({
      childUserId,
      requestId: req2.id,
      offerId: offerP.id,
    });
    await expect(
      cancelAcceptedHelpByGuardian({
        parentUserId: second.user.id,
        requestId: req2.id,
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("child cancellation still cancels the HelpRequest itself", async () => {
    const { parent, childUserId } = await setupFamily();
    const step = await createStudyStep({ childUserId, title: "Çocuk iptal" });
    const req = await createHelpRequest({
      childUserId,
      studyStepId: step.id,
      helpType: "DO_TOGETHER",
    });
    await createHelpOffer({
      parentUserId: parent.user.id,
      requestId: req.id,
      proposedDate: "2026-10-29",
      proposedTimeLocal: "14:00",
    });
    const cancelled = await cancelHelpRequest({
      childUserId,
      requestId: req.id,
    });
    expect(cancelled.status).toBe("CANCELLED");
    await expect(
      cancelAcceptedHelpByGuardian({
        parentUserId: parent.user.id,
        requestId: req.id,
      }),
    ).rejects.toMatchObject({ code: "VALIDATION" });
  });

  it("plan schedule change reopens accepted help; no silent stale session", async () => {
    const { parent, childUserId } = await setupFamily();
    const step = await createStudyStep({
      childUserId,
      title: "Plan değişimi",
      plannedDate: "2026-10-30",
    });
    const req = await createHelpRequest({
      childUserId,
      studyStepId: step.id,
      helpType: "EXPLAIN",
    });
    const offer = await createHelpOffer({
      parentUserId: parent.user.id,
      requestId: req.id,
      proposedDate: "2026-10-30",
      proposedTimeLocal: "18:00",
    });
    await acceptHelpOffer({
      childUserId,
      requestId: req.id,
      offerId: offer.id,
    });

    let sessions = await listChildHelpSessions(childUserId);
    expect(sessions.some((s) => s.requestId === req.id && s.status === "ACCEPTED")).toBe(
      true,
    );

    await updateStudyStep({
      childUserId,
      id: step.id,
      expectedRevision: step.revision,
      plannedDate: "2026-11-02",
    });

    const view = await getChildHelpRequest(childUserId, req.id);
    expect(view.status).toBe("OPEN");
    expect(view.acceptedOfferId).toBeNull();
    expect(view.lifecycleNotice).toBeTruthy();
    expect(view.offers.find((o) => o.id === offer.id)?.status).toBe("WITHDRAWN");

    sessions = await listChildHelpSessions(childUserId);
    expect(sessions.some((s) => s.requestId === req.id)).toBe(false);

    const childNotes = await listNotifications({
      recipientUserId: childUserId,
      filter: "all",
      limit: 40,
    });
    expect(childNotes.items.some((n) => n.kind === "HELP_REQUEST_REOPENED")).toBe(true);

    const parentNotes = await listNotifications({
      recipientUserId: parent.user.id,
      filter: "all",
      limit: 40,
    });
    expect(parentNotes.items.some((n) => n.kind === "HELP_REQUEST_REOPENED")).toBe(true);
  });

  it("privacy: lifecycle payloads never include journal/AI/reflection", async () => {
    const { parent, childUserId } = await setupFamily();
    const step = await createStudyStep({
      childUserId,
      title: "Gizlilik B1",
      plannedDate: "2026-11-01",
    });
    await prisma.planStudyStep.update({
      where: { id: step.id },
      data: { completionReflection: "GİZLİ_YANSIMA_B1" },
    });
    const req = await createHelpRequest({
      childUserId,
      studyStepId: step.id,
      helpType: "REVIEW",
      note: "Yardım notu açık",
    });
    const offer = await createHelpOffer({
      parentUserId: parent.user.id,
      requestId: req.id,
      proposedDate: "2026-11-01",
      proposedTimeLocal: "11:00",
      note: "Veli notu",
    });
    await acceptHelpOffer({
      childUserId,
      requestId: req.id,
      offerId: offer.id,
    });
    const cancelled = await cancelAcceptedHelpByGuardian({
      parentUserId: parent.user.id,
      requestId: req.id,
    });
    const raw = JSON.stringify(cancelled);
    expect(raw).not.toContain("GİZLİ_YANSIMA_B1");
    expect(raw).not.toContain("completionReflection");

    const parentView = await getParentHelpRequest(parent.user.id, req.id);
    expect(JSON.stringify(parentView)).not.toContain("GİZLİ_YANSIMA_B1");

    const notes = await listNotifications({
      recipientUserId: childUserId,
      filter: "all",
      limit: 40,
    });
    expect(JSON.stringify(notes)).not.toContain("GİZLİ_YANSIMA_B1");
  });

  it("foreign offer ids fail closed; child cannot edit guardian offers", async () => {
    const a = await setupFamily();
    const b = await setupFamily();
    const step = await createStudyStep({
      childUserId: a.childUserId,
      title: "Yabancı teklif",
    });
    const req = await createHelpRequest({
      childUserId: a.childUserId,
      studyStepId: step.id,
      helpType: "OTHER",
    });
    const offer = await createHelpOffer({
      parentUserId: a.parent.user.id,
      requestId: req.id,
      proposedDate: "2026-11-03",
      proposedTimeLocal: "10:00",
    });

    await expect(
      editHelpOffer({
        parentUserId: b.parent.user.id,
        offerId: offer.id,
        proposedDate: "2026-11-04",
        proposedTimeLocal: "11:00",
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    await expect(
      withdrawHelpOffer({ parentUserId: b.parent.user.id, offerId: offer.id }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    await expect(
      cancelAcceptedHelpByGuardian({
        parentUserId: b.parent.user.id,
        requestId: req.id,
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
