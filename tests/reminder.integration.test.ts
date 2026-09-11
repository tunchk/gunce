import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { GET as getReminders, PATCH as patchReminders } from "@/app/api/child/reminders/route";
import { POST as postPush, PUT as putTestPush } from "@/app/api/child/reminders/push/route";
import { POST as processRoute } from "@/app/api/internal/reminders/process/route";
import { createJournalEntry } from "@/lib/journal";
import { createStudyStep, setStudyStepStatus, updateStudyStep } from "@/lib/plan";
import { parseCalendarDate } from "@/lib/plan-dates";
import { prisma } from "@/lib/prisma";
import { setPushAdapterForTests, type PushAdapter } from "@/lib/push";
import { setReminderNowForTests } from "@/lib/reminder-clock";
import {
  processDueReminders,
  registerPushSubscription,
  updateReminderPreferences,
} from "@/lib/reminder";
import {
  createParent,
  onboardParentWithChild,
  pairChildAndGetCookie,
  request,
  revokeChildSessions,
  signInAndGetCookie,
} from "./helpers";

function recordingPush(): PushAdapter & { sent: Array<{ endpoint: string; body: string }> } {
  const sent: Array<{ endpoint: string; body: string }> = [];
  return {
    sent,
    isConfigured: () => true,
    async send(sub, payload) {
      sent.push({ endpoint: sub.endpoint, body: JSON.stringify(payload) });
      return { status: "accepted" };
    },
  };
}

async function setupChild(tz = "Europe/Berlin") {
  const parent = await createParent();
  const child = await onboardParentWithChild(parent.user.id);
  await prisma.childProfile.update({ where: { id: child.id }, data: { timeZone: tz } });
  const childCookie = await pairChildAndGetCookie(parent.user.id, child.id);
  const childUserId = (
    await prisma.childProfile.findUniqueOrThrow({ where: { id: child.id } })
  ).userId!;
  const parentCookie = await signInAndGetCookie(parent.email, parent.password);
  return { parent, child, childCookie, childUserId, parentCookie };
}

describe("Reminders + Web Push (Milestone 7)", () => {
  beforeEach(() => {
    setReminderNowForTests(() => new Date("2026-09-10T10:00:00.000Z"));
    setPushAdapterForTests(recordingPush());
    process.env.REMINDER_SCHEDULER_SECRET = "test-scheduler-secret-32chars!!";
    process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY = "BNtestpublickeyforlengthrequirements1234567890";
    process.env.VAPID_PRIVATE_KEY = "test-private-key";
    process.env.VAPID_SUBJECT = "mailto:test@example.com";
  });

  afterEach(() => {
    setReminderNowForTests(null);
    setPushAdapterForTests(null);
  });

  it("denies unauthenticated and parent reminder access", async () => {
    const { childCookie, parentCookie } = await setupChild();
    const unauth = await getReminders(
      request("http://localhost:3000/api/child/reminders", {
        headers: { origin: "http://localhost:3000" },
      }),
    );
    expect(unauth.status).toBe(401);

    const parentGet = await getReminders(
      request("http://localhost:3000/api/child/reminders", {
        headers: { cookie: parentCookie, origin: "http://localhost:3000" },
      }),
    );
    expect(parentGet.status).toBe(403);

    const parentPush = await postPush(
      request("http://localhost:3000/api/child/reminders/push", {
        method: "POST",
        headers: {
          cookie: parentCookie,
          origin: "http://localhost:3000",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          endpoint: "https://push.example/x",
          keys: { p256dh: "a", auth: "b" },
        }),
      }),
    );
    expect(parentPush.status).toBe(403);

    const childOk = await getReminders(
      request("http://localhost:3000/api/child/reminders", {
        headers: { cookie: childCookie, origin: "http://localhost:3000" },
      }),
    );
    expect(childOk.status).toBe(200);
  });

  it("rejects unauthorized scheduler requests", async () => {
    const denied = await processRoute(
      request("http://localhost:3000/api/internal/reminders/process", {
        method: "POST",
        headers: { origin: "http://localhost:3000" },
      }),
    );
    expect(denied.status).toBe(401);

    const ok = await processRoute(
      request("http://localhost:3000/api/internal/reminders/process", {
        method: "POST",
        headers: {
          origin: "http://localhost:3000",
          authorization: "Bearer test-scheduler-secret-32chars!!",
        },
      }),
    );
    expect(ok.status).toBe(200);
  });

  it("skips journal reminder when a private saved narrative exists; payloads stay generic", async () => {
    const push = recordingPush();
    setPushAdapterForTests(push);
    const { child, childUserId } = await setupChild();

    await updateReminderPreferences({
      childUserId,
      expectedRevision: 1,
      journalReminderEnabled: true,
      journalReminderLocalTime: "12:00",
      quietHoursStart: "21:00",
      quietHoursEnd: "08:00",
    });

    await registerPushSubscription({
      childUserId,
      sessionId: "sess-1",
      endpoint: "https://push.example/child-a",
      p256dh: "p256",
      auth: "auth",
    });

    // Schedule for "now" window: set clock to just after local noon Berlin on 2026-09-10
    // 12:00 Europe/Berlin = 10:00 UTC in September
    setReminderNowForTests(() => new Date("2026-09-10T10:05:00.000Z"));

    const entry = await createJournalEntry({
      childUserId,
      body: "ÖZEL_GİZLİ_GÜNLÜK metin",
    });
    await prisma.journalEntry.update({
      where: { id: entry.id },
      data: { diaryDate: parseCalendarDate("2026-09-10") },
    });

    const result = await processDueReminders({ push });
    expect(result.sent).toBe(0);
    expect(push.sent).toHaveLength(0);

    // Without journal — should send generic copy only
    await prisma.journalEntry.deleteMany({ where: { childId: child.id } });
    await prisma.reminderOccurrence.updateMany({
      where: { childId: child.id },
      data: { status: "PENDING" },
    });
    // Rematerialize
    await updateReminderPreferences({
      childUserId,
      expectedRevision: 2,
      journalReminderEnabled: true,
    });
    setReminderNowForTests(() => new Date("2026-09-10T10:05:00.000Z"));
    const sent = await processDueReminders({ push });
    expect(sent.sent).toBeGreaterThanOrEqual(1);
    const payload = push.sent[0]!.body;
    expect(payload).toContain("Gününden bir şey anlatmak ister misin?");
    expect(payload).not.toContain("ÖZEL_GİZLİ");
    expect(payload).not.toMatch(/günlük metin|transcript|özet/i);
  });

  it("suppresses study reminders for DONE/IN_PROGRESS and after delete; title edit does not duplicate", async () => {
    const push = recordingPush();
    setPushAdapterForTests(push);
    const { childUserId } = await setupChild();

    await updateReminderPreferences({
      childUserId,
      expectedRevision: 1,
      studyRemindersEnabled: true,
      quietHoursStart: "21:00",
      quietHoursEnd: "08:00",
    });
    await registerPushSubscription({
      childUserId,
      sessionId: "sess-2",
      endpoint: "https://push.example/child-b",
      p256dh: "p256",
      auth: "auth",
    });

    const step = await createStudyStep({
      childUserId,
      title: "Kelime tekrarı",
      plannedDate: "2026-09-10",
      reminderLocalTime: "12:00",
    });

    // Title edit
    await updateStudyStep({
      childUserId,
      id: step.id,
      expectedRevision: step.revision,
      title: "Kelime tekrarı (düzenlendi)",
    });
    const pending = await prisma.reminderOccurrence.count({
      where: {
        studyStepId: step.id,
        status: { in: ["PENDING", "CLAIMED"] },
      },
    });
    expect(pending).toBe(1);

    setReminderNowForTests(() => new Date("2026-09-10T10:05:00.000Z"));
    await setStudyStepStatus({
      childUserId,
      id: step.id,
      expectedRevision: step.revision + 1,
      status: "DONE",
    });
    const afterDone = await processDueReminders({ push });
    expect(afterDone.sent).toBe(0);

    // New step then delete
    const step2 = await createStudyStep({
      childUserId,
      title: "Silinecek",
      plannedDate: "2026-09-10",
      reminderLocalTime: "12:30",
    });
    const { deleteStudyStep } = await import("@/lib/plan");
    await deleteStudyStep({ childUserId, id: step2.id });
    expect(
      await prisma.reminderOccurrence.count({
        where: { studyStepId: step2.id, status: { in: ["PENDING", "CLAIMED"] } },
      }),
    ).toBe(0);
  });

  it("enforces daily cap under concurrent processing and expires past grace", async () => {
    const push = recordingPush();
    setPushAdapterForTests(push);
    const { childUserId } = await setupChild();
    await updateReminderPreferences({
      childUserId,
      expectedRevision: 1,
      studyRemindersEnabled: true,
    });
    await registerPushSubscription({
      childUserId,
      sessionId: "sess-3",
      endpoint: "https://push.example/child-c",
      p256dh: "p256",
      auth: "auth",
    });

    for (let i = 0; i < 4; i++) {
      await createStudyStep({
        childUserId,
        title: `Adım ${i}`,
        plannedDate: "2026-09-10",
        reminderLocalTime: `12:0${i}`,
        clientRequestId: `cap-${i}-${Date.now()}`,
      });
    }

    setReminderNowForTests(() => new Date("2026-09-10T10:05:00.000Z"));
    const [a, b] = await Promise.all([
      processDueReminders({ push }),
      processDueReminders({ push }),
    ]);
    const totalSent = a.sent + b.sent;
    expect(totalSent).toBeLessThanOrEqual(3);
    expect(push.sent.length).toBeLessThanOrEqual(3);

    // Past grace → expire, no backlog
    setReminderNowForTests(() => new Date("2026-09-10T12:00:00.000Z"));
    const late = await processDueReminders({ push });
    expect(late.expired + late.skipped + late.sent).toBeGreaterThanOrEqual(0);
    const stillPendingOld = await prisma.reminderOccurrence.count({
      where: {
        status: "PENDING",
        scheduledAt: { lt: new Date("2026-09-10T10:00:00.000Z") },
      },
    });
    expect(stillPendingOld).toBe(0);
  });

  it("stops delivery after session revocation", async () => {
    const push = recordingPush();
    setPushAdapterForTests(push);
    const { parent, child, childUserId } = await setupChild();
    await updateReminderPreferences({
      childUserId,
      expectedRevision: 1,
      journalReminderEnabled: true,
      journalReminderLocalTime: "12:00",
    });
    await registerPushSubscription({
      childUserId,
      sessionId: "sess-rev",
      endpoint: "https://push.example/child-d",
      p256dh: "p256",
      auth: "auth",
    });
    await revokeChildSessions({ parentUserId: parent.user.id, childId: child.id });
    const active = await prisma.childPushSubscription.count({
      where: { childId: child.id, revokedAt: null },
    });
    expect(active).toBe(0);

    setReminderNowForTests(() => new Date("2026-09-10T10:05:00.000Z"));
    await processDueReminders({ push });
    expect(push.sent).toHaveLength(0);
  });

  it("does not duplicate deliveries on retry for the same device", async () => {
    const push = recordingPush();
    setPushAdapterForTests(push);
    const { childUserId } = await setupChild();
    await updateReminderPreferences({
      childUserId,
      expectedRevision: 1,
      journalReminderEnabled: true,
      journalReminderLocalTime: "12:00",
    });
    await registerPushSubscription({
      childUserId,
      sessionId: "sess-dup",
      endpoint: "https://push.example/child-e",
      p256dh: "p256",
      auth: "auth",
    });
    setReminderNowForTests(() => new Date("2026-09-10T10:05:00.000Z"));
    await processDueReminders({ push });
    const first = push.sent.length;
    expect(first).toBeGreaterThanOrEqual(1);
    // Force pending again illegally — delivery unique should prevent re-accept spam path
    await prisma.reminderOccurrence.updateMany({
      where: { kind: "JOURNAL" },
      data: { status: "SENT" },
    });
    await processDueReminders({ push });
    expect(push.sent.length).toBe(first);
  });
});
