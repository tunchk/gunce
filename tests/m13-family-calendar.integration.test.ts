import { describe, expect, it } from "vitest";
import {
  acceptGuardianInvitation,
  inviteGuardian,
  removeGuardianAccess,
} from "@/lib/guardian";
import {
  slotsPossiblyConflict,
  detectPossibleConflictIds,
} from "@/lib/family-calendar-conflicts";
import { getFamilyCoordinationWeek } from "@/lib/family-calendar";
import {
  cancelFamilyEvent,
  createFamilyEvent,
  FamilyEventError,
  updateFamilyEvent,
} from "@/lib/family-events";
import {
  acceptHelpOffer,
  cancelAcceptedHelpByGuardian,
  cancelHelpRequest,
  createHelpOffer,
  createHelpRequest,
} from "@/lib/help";
import { createStudyStep, updateStudyStep } from "@/lib/plan";
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
  const parent = await createParent({ email: `m13_p_${Date.now()}@example.com` });
  await verifyParentEmail(parent.user.id);
  const child = await onboardParentWithChild(parent.user.id);
  await pairChildAndGetCookie(parent.user.id, child.id);
  const childUserId = (
    await prisma.childProfile.findUniqueOrThrow({ where: { id: child.id } })
  ).userId!;
  return { parent, child, childUserId };
}

describe("M13 family coordination calendar", () => {
  it("aggregates plan + help + family events; ordered; cancelled excluded", async () => {
    const { parent, child, childUserId } = await setupFamily();
    const step = await createStudyStep({
      childUserId,
      title: "Matematik",
      plannedDate: "2026-10-13",
    });
    const req = await createHelpRequest({
      childUserId,
      studyStepId: step.id,
      helpType: "EXPLAIN",
    });
    const offer = await createHelpOffer({
      parentUserId: parent.user.id,
      requestId: req.id,
      proposedDate: "2026-10-13",
      proposedTimeLocal: "18:00",
    });
    await acceptHelpOffer({
      childUserId,
      requestId: req.id,
      offerId: offer.id,
    });

    await createFamilyEvent({
      actorUserId: childUserId,
      actorRole: "CHILD",
      title: "Dişçi",
      eventDate: "2026-10-14",
      startTimeLocal: "10:00",
      endTimeLocal: "11:00",
      eventType: "APPOINTMENT",
    });
    const cancelled = await createFamilyEvent({
      actorUserId: parent.user.id,
      actorRole: "PARENT",
      childId: child.id,
      title: "İptal olacak",
      eventDate: "2026-10-15",
      eventType: "FAMILY",
    });
    await cancelFamilyEvent({
      actorUserId: parent.user.id,
      eventId: cancelled.id,
    });

    const week = await getFamilyCoordinationWeek({
      viewerUserId: childUserId,
      viewerRole: "CHILD",
      weekStartIso: "2026-10-12",
    });

    const flat = week.days.flatMap((d) => d.items);
    expect(flat.some((i) => i.kind === "STUDY_STEP" && i.title === "Matematik")).toBe(
      true,
    );
    expect(flat.some((i) => i.kind === "HELP_SESSION" && i.startTimeLocal === "18:00")).toBe(
      true,
    );
    expect(flat.some((i) => i.kind === "FAMILY_EVENT" && i.title === "Dişçi")).toBe(true);
    expect(flat.some((i) => i.title === "İptal olacak")).toBe(false);
    expect(JSON.stringify(week)).not.toContain("completionReflection");
    expect(JSON.stringify(week)).not.toContain("journal");

    const day13 = week.days.find((d) => d.date === "2026-10-13")!;
    const keys = day13.items.map((i) => `${i.startTimeLocal ?? "99"}:${i.kind}`);
    expect(keys).toEqual([...keys].sort());
  });

  it("reopened/cancelled help disappears from calendar; fallback accept reappears", async () => {
    const { parent, child, childUserId } = await setupFamily();
    const second = await createParent({ email: `m13_g2_${Date.now()}@example.com` });
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
      title: "Fen",
      plannedDate: "2026-10-16",
    });
    const req = await createHelpRequest({
      childUserId,
      studyStepId: step.id,
      helpType: "REVIEW",
    });
    const o1 = await createHelpOffer({
      parentUserId: parent.user.id,
      requestId: req.id,
      proposedDate: "2026-10-16",
      proposedTimeLocal: "17:00",
    });
    const o2 = await createHelpOffer({
      parentUserId: second.user.id,
      requestId: req.id,
      proposedDate: "2026-10-16",
      proposedTimeLocal: "19:00",
    });
    await acceptHelpOffer({ childUserId, requestId: req.id, offerId: o1.id });

    let week = await getFamilyCoordinationWeek({
      viewerUserId: parent.user.id,
      viewerRole: "PARENT",
      childId: child.id,
      weekStartIso: "2026-10-12",
    });
    expect(
      week.days.flatMap((d) => d.items).some((i) => i.kind === "HELP_SESSION"),
    ).toBe(true);

    await cancelAcceptedHelpByGuardian({
      parentUserId: parent.user.id,
      requestId: req.id,
    });
    week = await getFamilyCoordinationWeek({
      viewerUserId: childUserId,
      viewerRole: "CHILD",
      weekStartIso: "2026-10-12",
    });
    expect(
      week.days.flatMap((d) => d.items).some((i) => i.kind === "HELP_SESSION"),
    ).toBe(false);

    await acceptHelpOffer({ childUserId, requestId: req.id, offerId: o2.id });
    week = await getFamilyCoordinationWeek({
      viewerUserId: childUserId,
      viewerRole: "CHILD",
      weekStartIso: "2026-10-12",
    });
    const help = week.days
      .flatMap((d) => d.items)
      .find((i) => i.kind === "HELP_SESSION");
    expect(help?.startTimeLocal).toBe("19:00");

    await cancelHelpRequest({ childUserId, requestId: req.id });
    week = await getFamilyCoordinationWeek({
      viewerUserId: childUserId,
      viewerRole: "CHILD",
      weekStartIso: "2026-10-12",
    });
    expect(
      week.days.flatMap((d) => d.items).some((i) => i.kind === "HELP_SESSION"),
    ).toBe(false);
  });

  it("plan schedule change removes stale accepted help from calendar", async () => {
    const { parent, childUserId } = await setupFamily();
    const step = await createStudyStep({
      childUserId,
      title: "Tarih değişimi",
      plannedDate: "2026-10-20",
    });
    const req = await createHelpRequest({
      childUserId,
      studyStepId: step.id,
      helpType: "DO_TOGETHER",
    });
    const offer = await createHelpOffer({
      parentUserId: parent.user.id,
      requestId: req.id,
      proposedDate: "2026-10-20",
      proposedTimeLocal: "16:00",
    });
    await acceptHelpOffer({ childUserId, requestId: req.id, offerId: offer.id });

    await updateStudyStep({
      childUserId,
      id: step.id,
      expectedRevision: step.revision,
      plannedDate: "2026-10-22",
    });

    const week = await getFamilyCoordinationWeek({
      viewerUserId: childUserId,
      viewerRole: "CHILD",
      weekStartIso: "2026-10-19",
    });
    expect(
      week.days.flatMap((d) => d.items).some((i) => i.kind === "HELP_SESSION"),
    ).toBe(false);
  });

  it("authorization: revoked/foreign denied; creator-only mutate", async () => {
    const a = await setupFamily();
    const b = await setupFamily();
    const second = await createParent({ email: `m13_rev_${Date.now()}@example.com` });
    await verifyParentEmail(second.user.id);
    const { token } = await inviteGuardian({
      managerUserId: a.parent.user.id,
      childId: a.child.id,
      email: second.email,
    });
    await acceptGuardianInvitation({
      token,
      acceptorUserId: second.user.id,
    });

    const ev = await createFamilyEvent({
      actorUserId: a.parent.user.id,
      actorRole: "PARENT",
      childId: a.child.id,
      title: "Doğum günü",
      eventDate: "2026-10-18",
      eventType: "FAMILY",
    });

    await expect(
      getFamilyCoordinationWeek({
        viewerUserId: b.parent.user.id,
        viewerRole: "PARENT",
        childId: a.child.id,
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    await expect(
      updateFamilyEvent({
        actorUserId: second.user.id,
        eventId: ev.id,
        title: "Hack",
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    await expect(
      updateFamilyEvent({
        actorUserId: a.childUserId,
        eventId: ev.id,
        title: "Çocuk değiştiremez",
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    await removeGuardianAccess({
      managerUserId: a.parent.user.id,
      childId: a.child.id,
      targetUserId: second.user.id,
    });
    await expect(
      getFamilyCoordinationWeek({
        viewerUserId: second.user.id,
        viewerRole: "PARENT",
        childId: a.child.id,
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      cancelFamilyEvent({ actorUserId: second.user.id, eventId: ev.id }),
    ).rejects.toBeInstanceOf(FamilyEventError);
  });

  it("family event lifecycle: child and guardian own events", async () => {
    const { parent, child, childUserId } = await setupFamily();
    const childEv = await createFamilyEvent({
      actorUserId: childUserId,
      actorRole: "CHILD",
      title: "Spor",
      eventDate: "2026-10-17",
      startTimeLocal: "15:00",
      eventType: "ACTIVITY",
    });
    const updated = await updateFamilyEvent({
      actorUserId: childUserId,
      eventId: childEv.id,
      title: "Basketbol",
    });
    expect(updated.title).toBe("Basketbol");

    await expect(
      updateFamilyEvent({
        actorUserId: parent.user.id,
        eventId: childEv.id,
        title: "Veli düzenleyemez",
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    const parentEv = await createFamilyEvent({
      actorUserId: parent.user.id,
      actorRole: "PARENT",
      childId: child.id,
      title: "Okul gecesi",
      eventDate: "2026-10-17",
      eventType: "SCHOOL",
    });
    await cancelFamilyEvent({
      actorUserId: parent.user.id,
      eventId: parentEv.id,
    });
    const week = await getFamilyCoordinationWeek({
      viewerUserId: childUserId,
      viewerRole: "CHILD",
      weekStartIso: "2026-10-12",
    });
    expect(week.days.flatMap((d) => d.items).some((i) => i.title === "Okul gecesi")).toBe(
      false,
    );
    expect(week.days.flatMap((d) => d.items).some((i) => i.title === "Basketbol")).toBe(
      true,
    );
  });

  it("conflict detection rules", () => {
    expect(
      slotsPossiblyConflict(
        {
          id: "a",
          date: "2026-10-10",
          startTimeLocal: "10:00",
          endTimeLocal: "11:00",
        },
        {
          id: "b",
          date: "2026-10-10",
          startTimeLocal: "10:30",
          endTimeLocal: "11:30",
        },
      ),
    ).toBe(true);

    expect(
      slotsPossiblyConflict(
        {
          id: "a",
          date: "2026-10-10",
          startTimeLocal: "10:00",
          endTimeLocal: "11:00",
        },
        { id: "b", date: "2026-10-10", startTimeLocal: "10:30", endTimeLocal: null },
      ),
    ).toBe(true);

    expect(
      slotsPossiblyConflict(
        { id: "a", date: "2026-10-10", startTimeLocal: "18:00", endTimeLocal: null },
        { id: "b", date: "2026-10-10", startTimeLocal: "18:00", endTimeLocal: null },
      ),
    ).toBe(true);

    expect(
      slotsPossiblyConflict(
        { id: "a", date: "2026-10-10", startTimeLocal: null, endTimeLocal: null },
        { id: "b", date: "2026-10-10", startTimeLocal: null, endTimeLocal: null },
      ),
    ).toBe(false);

    expect(
      slotsPossiblyConflict(
        { id: "a", date: "2026-10-10", startTimeLocal: "18:00", endTimeLocal: null },
        { id: "b", date: "2026-10-11", startTimeLocal: "18:00", endTimeLocal: null },
      ),
    ).toBe(false);

    const ids = detectPossibleConflictIds([
      {
        id: "1",
        date: "2026-10-10",
        startTimeLocal: "09:00",
        endTimeLocal: "10:00",
      },
      {
        id: "2",
        date: "2026-10-10",
        startTimeLocal: "09:30",
        endTimeLocal: "09:45",
      },
      { id: "3", date: "2026-10-10", startTimeLocal: null, endTimeLocal: null },
    ]);
    expect(ids.has("1")).toBe(true);
    expect(ids.has("2")).toBe(true);
    expect(ids.has("3")).toBe(false);
  });

  it("marks possible conflict on aggregated timed items", async () => {
    const { parent, childUserId } = await setupFamily();
    const step = await createStudyStep({
      childUserId,
      title: "Yardım konusu",
      plannedDate: "2026-10-21",
    });
    const req = await createHelpRequest({
      childUserId,
      studyStepId: step.id,
      helpType: "EXPLAIN",
    });
    const offer = await createHelpOffer({
      parentUserId: parent.user.id,
      requestId: req.id,
      proposedDate: "2026-10-21",
      proposedTimeLocal: "10:30",
    });
    await acceptHelpOffer({ childUserId, requestId: req.id, offerId: offer.id });
    await createFamilyEvent({
      actorUserId: childUserId,
      actorRole: "CHILD",
      title: "Diş",
      eventDate: "2026-10-21",
      startTimeLocal: "10:00",
      endTimeLocal: "11:00",
      eventType: "APPOINTMENT",
    });

    const week = await getFamilyCoordinationWeek({
      viewerUserId: childUserId,
      viewerRole: "CHILD",
      weekStartIso: "2026-10-19",
    });
    const day = week.days.find((d) => d.date === "2026-10-21")!;
    const timed = day.items.filter(
      (i) => i.kind === "HELP_SESSION" || i.kind === "FAMILY_EVENT",
    );
    expect(timed.every((i) => i.possibleConflict)).toBe(true);
  });
});
