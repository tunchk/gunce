import { describe, expect, it } from "vitest";
import {
  acceptGuardianInvitation,
  inviteGuardian,
  removeGuardianAccess,
} from "@/lib/guardian";
import {
  acceptHelpOffer,
  cancelHelpRequest,
  createHelpOffer,
  createHelpRequest,
  getParentHelpRequest,
  HelpError,
  listParentHelpInbox,
  withdrawHelpOffer,
} from "@/lib/help";
import { createStudyStep } from "@/lib/plan";
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
  const parent = await createParent({ email: `help_p_${Date.now()}@example.com` });
  await verifyParentEmail(parent.user.id);
  const child = await onboardParentWithChild(parent.user.id);
  await pairChildAndGetCookie(parent.user.id, child.id);
  const childUserId = (
    await prisma.childProfile.findUniqueOrThrow({ where: { id: child.id } })
  ).userId!;
  return { parent, child, childUserId };
}

describe("M12B child-initiated help", () => {
  it("child creates request; guardian sees it; unrelated guardian does not", async () => {
    const { parent, child, childUserId } = await setupFamily();
    const step = await createStudyStep({
      childUserId,
      title: "Matematik tekrar",
      plannedDate: "2026-10-10",
    });

    const other = await createParent({ email: `help_x_${Date.now()}@example.com` });
    await verifyParentEmail(other.user.id);

    const req = await createHelpRequest({
      childUserId,
      studyStepId: step.id,
      helpType: "DO_TOGETHER",
      note: "Birlikte çözelim",
    });
    expect(req.status).toBe("OPEN");
    expect(req.note).toBe("Birlikte çözelim");
    expect(JSON.stringify(req)).not.toContain("journal");

    const inbox = await listParentHelpInbox(parent.user.id, child.id);
    expect(inbox.waiting.some((r) => r.id === req.id)).toBe(true);

    await expect(getParentHelpRequest(other.user.id, req.id)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });

    const notes = await listNotifications({
      recipientUserId: parent.user.id,
      filter: "all",
      limit: 20,
    });
    expect(notes.items.some((n) => n.kind === "HELP_REQUEST_CREATED")).toBe(true);
    expect(JSON.stringify(notes)).not.toContain("Birlikte çözelim");
  });

  it("child cannot request for another child's plan item", async () => {
    const a = await setupFamily();
    const b = await setupFamily();
    const step = await createStudyStep({
      childUserId: a.childUserId,
      title: "Yabancı adım",
    });
    await expect(
      createHelpRequest({
        childUserId: b.childUserId,
        studyStepId: step.id,
        helpType: "EXPLAIN",
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("multiple guardians can offer; child accepts one; second cannot win", async () => {
    const { parent, child, childUserId } = await setupFamily();
    const second = await createParent({ email: `help_g2_${Date.now()}@example.com` });
    await verifyParentEmail(second.user.id);
    const { token } = await inviteGuardian({
      managerUserId: parent.user.id,
      childId: child.id,
      email: second.email,
    });
    await acceptGuardianInvitation({
      token,
      acceptorUserId: second.user.id,
    });

    const step = await createStudyStep({
      childUserId,
      title: "Fen soruları",
      plannedDate: "2026-10-12",
    });
    const req = await createHelpRequest({
      childUserId,
      studyStepId: step.id,
      helpType: "REVIEW",
    });

    const offer1 = await createHelpOffer({
      parentUserId: parent.user.id,
      requestId: req.id,
      proposedDate: "2026-10-12",
      proposedTimeLocal: "18:00",
    });
    const offer2 = await createHelpOffer({
      parentUserId: second.user.id,
      requestId: req.id,
      proposedDate: "2026-10-13",
      proposedTimeLocal: "17:30",
    });
    expect(offer1.status).toBe("PENDING");
    expect(offer2.status).toBe("PENDING");

    const childNotes = await listNotifications({
      recipientUserId: childUserId,
      filter: "all",
      limit: 20,
    });
    expect(childNotes.items.filter((n) => n.kind === "HELP_OFFER_CREATED").length).toBe(2);

    const accepted = await acceptHelpOffer({
      childUserId,
      requestId: req.id,
      offerId: offer1.id,
    });
    expect(accepted.status).toBe("ACCEPTED");
    expect(accepted.acceptedOfferId).toBe(offer1.id);
    expect(accepted.offers.find((o) => o.id === offer1.id)?.status).toBe("ACCEPTED");
    // Sibling offers stay PENDING so the child can pick another if the accepted guardian withdraws later.
    expect(accepted.offers.find((o) => o.id === offer2.id)?.status).toBe("PENDING");
    expect(accepted.offers.find((o) => o.id === offer1.id)?.proposedTimeLocal).toBe("18:00");

    await expect(
      acceptHelpOffer({
        childUserId,
        requestId: req.id,
        offerId: offer2.id,
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });

    const parentNotes = await listNotifications({
      recipientUserId: parent.user.id,
      filter: "all",
      limit: 30,
    });
    expect(parentNotes.items.some((n) => n.kind === "HELP_OFFER_ACCEPTED")).toBe(true);
  });

  it("cancel blocks offers; withdrawn offer cannot be accepted", async () => {
    const { parent, childUserId } = await setupFamily();
    const step = await createStudyStep({
      childUserId,
      title: "İptal denemesi",
    });
    const req = await createHelpRequest({
      childUserId,
      studyStepId: step.id,
      helpType: "OTHER",
    });
    const offer = await createHelpOffer({
      parentUserId: parent.user.id,
      requestId: req.id,
      proposedDate: "2026-10-14",
      proposedTimeLocal: "16:00",
    });
    await withdrawHelpOffer({ parentUserId: parent.user.id, offerId: offer.id });

    await expect(
      acceptHelpOffer({
        childUserId,
        requestId: req.id,
        offerId: offer.id,
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    const req2 = await createHelpRequest({
      childUserId,
      studyStepId: (
        await createStudyStep({ childUserId, title: "İkinci" })
      ).id,
      helpType: "EXPLAIN",
    });
    await cancelHelpRequest({ childUserId, requestId: req2.id });
    await expect(
      createHelpOffer({
        parentUserId: parent.user.id,
        requestId: req2.id,
        proposedDate: "2026-10-15",
        proposedTimeLocal: "10:00",
      }),
    ).rejects.toMatchObject({ code: "GONE" });
  });

  it("revoked guardian cannot access or complete acceptance path", async () => {
    const { parent, child, childUserId } = await setupFamily();
    const second = await createParent({ email: `help_rev_${Date.now()}@example.com` });
    await verifyParentEmail(second.user.id);
    const { token } = await inviteGuardian({
      managerUserId: parent.user.id,
      childId: child.id,
      email: second.email,
    });
    await acceptGuardianInvitation({
      token,
      acceptorUserId: second.user.id,
    });

    const step = await createStudyStep({ childUserId, title: "Revoke test" });
    const req = await createHelpRequest({
      childUserId,
      studyStepId: step.id,
      helpType: "DO_TOGETHER",
    });
    const offer = await createHelpOffer({
      parentUserId: second.user.id,
      requestId: req.id,
      proposedDate: "2026-10-16",
      proposedTimeLocal: "19:00",
    });

    await removeGuardianAccess({
      managerUserId: parent.user.id,
      childId: child.id,
      targetUserId: second.user.id,
    });

    await expect(getParentHelpRequest(second.user.id, req.id)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await expect(
      acceptHelpOffer({
        childUserId,
        requestId: req.id,
        offerId: offer.id,
      }),
    ).rejects.toMatchObject({ code: "GONE" });
  });

  it("parent help payload has no journal fields; completionReflection untouched", async () => {
    const { parent, child, childUserId } = await setupFamily();
    const step = await createStudyStep({
      childUserId,
      title: "Gizlilik",
      plannedDate: "2026-10-17",
    });
    await prisma.planStudyStep.update({
      where: { id: step.id },
      data: { completionReflection: "GİZLİ_YANSIMA_ASLA" },
    });
    const req = await createHelpRequest({
      childUserId,
      studyStepId: step.id,
      helpType: "REVIEW",
      note: "Açık yardım notu",
    });
    const view = await getParentHelpRequest(parent.user.id, req.id);
    const raw = JSON.stringify(view);
    expect(raw).toContain("Açık yardım notu");
    expect(raw).not.toContain("GİZLİ_YANSIMA_ASLA");
    expect(raw).not.toContain("body");
    expect(raw).not.toContain("completionReflection");

    const inbox = await listParentHelpInbox(parent.user.id, child.id);
    expect(JSON.stringify(inbox)).not.toContain("GİZLİ_YANSIMA_ASLA");
  });

  it("duplicate active request for same item is rejected", async () => {
    const { childUserId } = await setupFamily();
    const step = await createStudyStep({ childUserId, title: "Tek istek" });
    await createHelpRequest({
      childUserId,
      studyStepId: step.id,
      helpType: "DO_TOGETHER",
    });
    await expect(
      createHelpRequest({
        childUserId,
        studyStepId: step.id,
        helpType: "EXPLAIN",
      }),
    ).rejects.toBeInstanceOf(HelpError);
  });
});
