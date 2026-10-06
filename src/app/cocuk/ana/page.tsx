import Link from "next/link";
import { redirect } from "next/navigation";
import { NotificationBell } from "@/components/notification-bell";
import { NextStudyStepPanel, PlanParentNotice } from "@/components/plan-home-panels";
import { Button, ChildSettingsLink, Panel, Shell } from "@/components/ui";
import { avatarEmoji } from "@/lib/constants";
import {
  getNextStudyStepForToday,
  getWeekPlanForChild,
  listMissedStudySteps,
} from "@/lib/plan";
import { listChildHelpRequests, listChildHelpSessions } from "@/lib/help";
import { formatDayLabelTr } from "@/lib/plan-dates";
import { commitmentTypeLabel } from "@/lib/plan-ui";
import { getAppSession, getChildProfileForUser } from "@/lib/session";

export default async function ChildHomePage() {
  const session = await getAppSession();
  if (!session || session.user.role !== "CHILD") redirect("/cocuk/giris");

  const child = await getChildProfileForUser(session.user.id);
  if (!child) redirect("/cocuk/giris");
  if (child.onboardingStep !== "COMPLETE") redirect("/cocuk");

  const [nextStep, week, missed, helpRequests, helpSessions] = await Promise.all([
    getNextStudyStepForToday(session.user.id),
    getWeekPlanForChild(session.user.id),
    listMissedStudySteps(session.user.id),
    listChildHelpRequests(session.user.id),
    listChildHelpSessions(session.user.id),
  ]);

  const todaySessions = helpSessions.filter(
    (s) => s.status === "ACCEPTED" && s.proposedDate === week.today,
  );
  const openHelp = helpRequests.filter(
    (r) => r.status === "OPEN" || r.status === "OFFERED" || r.status === "ACCEPTED",
  );

  const todayDay = week.days.find((d) => d.date === week.today);
  const todayCommitments = todayDay?.commitments.filter((c) => !c.completedAt) ?? [];
  const todayOpenSteps =
    todayDay?.studySteps.filter((s) => s.status !== "DONE") ?? [];

  const approachingCommitments = week.days
    .filter((d) => d.date > week.today)
    .flatMap((d) =>
      d.commitments
        .filter((c) => !c.completedAt)
        .map((c) => ({ ...c, date: d.date })),
    )
    .slice(0, 4);

  const approachingSteps = week.days
    .filter((d) => d.date > week.today)
    .flatMap((d) =>
      d.studySteps
        .filter((s) => s.status !== "DONE")
        .map((s) => ({ ...s, date: d.date })),
    )
    .slice(0, 4);

  return (
    <Shell
      title={`${avatarEmoji(child.avatarKey)} ${child.displayName}`}
      subtitle="Bugün"
      withChildNav
      headerAction={
        <div className="flex items-center gap-2">
          <NotificationBell href="/cocuk/bildirimler" />
          <ChildSettingsLink />
        </div>
      }
    >
      <div className="space-y-4">
        <PlanParentNotice />

        <Panel>
          <NextStudyStepPanel step={nextStep} />
        </Panel>

        <Panel>
          <h2 className="text-lg font-semibold">Bugün</h2>
          <p className="mt-1 text-sm" style={{ color: "var(--muted)" }}>
            {formatDayLabelTr(week.today)}
          </p>
          {todayCommitments.length === 0 &&
          todayOpenSteps.length === 0 &&
          todaySessions.length === 0 ? (
            <p className="mt-3 text-sm leading-relaxed" style={{ color: "var(--muted)" }}>
              Bugün için planlanmış açık bir iş yok.
            </p>
          ) : (
            <ul className="mt-3 space-y-2">
              {todayCommitments.map((c) => (
                <li key={c.id} className="text-sm leading-relaxed">
                  <Link href={`/cocuk/plan/is/${c.id}`} className="font-semibold underline">
                    {commitmentTypeLabel(c.type)}: {c.title}
                  </Link>
                </li>
              ))}
              {todayOpenSteps.map((s) => (
                <li key={s.id} className="text-sm leading-relaxed">
                  <Link href={`/cocuk/plan/adim/${s.id}`} className="font-semibold underline">
                    {s.title}
                  </Link>
                </li>
              ))}
              {todaySessions.map((s) => (
                <li key={s.requestId} className="text-sm leading-relaxed">
                  <Link
                    href={`/cocuk/yardim/${s.requestId}`}
                    className="font-semibold underline"
                  >
                    Yardım: {s.planItem.title} · {s.proposedTimeLocal} ({s.guardianName})
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        {(missed.length > 0 ||
          approachingCommitments.length > 0 ||
          approachingSteps.length > 0) && (
          <Panel>
            <h2 className="text-lg font-semibold">Yaklaşan</h2>
            <ul className="mt-3 space-y-2">
              {missed.slice(0, 3).map((s) => (
                <li key={s.id} className="text-sm leading-relaxed">
                  <Link href={`/cocuk/plan/adim/${s.id}`} className="font-semibold underline">
                    {s.title}
                  </Link>{" "}
                  <span style={{ color: "var(--muted)" }}>
                    ({s.plannedDate ? formatDayLabelTr(s.plannedDate) : "tarihsiz"} · gecikmiş)
                  </span>
                </li>
              ))}
              {approachingCommitments.map((c) => (
                <li key={c.id} className="text-sm leading-relaxed">
                  <Link href={`/cocuk/plan/is/${c.id}`} className="font-semibold underline">
                    {commitmentTypeLabel(c.type)}: {c.title}
                  </Link>{" "}
                  <span style={{ color: "var(--muted)" }}>
                    ({formatDayLabelTr(c.date)})
                  </span>
                </li>
              ))}
              {approachingSteps.map((s) => (
                <li key={s.id} className="text-sm leading-relaxed">
                  <Link href={`/cocuk/plan/adim/${s.id}`} className="font-semibold underline">
                    {s.title}
                  </Link>{" "}
                  <span style={{ color: "var(--muted)" }}>
                    ({formatDayLabelTr(s.date)})
                  </span>
                </li>
              ))}
            </ul>
            <Link href="/cocuk/haftam" className="mt-4 block">
              <Button variant="secondary">Haftama git</Button>
            </Link>
          </Panel>
        )}

        {openHelp.length > 0 ? (
          <Panel>
            <h2 className="text-lg font-semibold">Yardım</h2>
            <ul className="mt-3 space-y-2">
              {openHelp.slice(0, 3).map((r) => (
                <li key={r.id} className="text-sm leading-relaxed">
                  <Link href={`/cocuk/yardim/${r.id}`} className="font-semibold underline">
                    {r.planItem.title}
                  </Link>{" "}
                  <span style={{ color: "var(--muted)" }}>({r.statusLabel})</span>
                </li>
              ))}
            </ul>
            <Link href="/cocuk/yardim" className="mt-4 block">
              <Button variant="secondary">Yardımlarıma git</Button>
            </Link>
          </Panel>
        ) : (
          <Panel>
            <h2 className="text-lg font-semibold">Yardım</h2>
            <p className="mt-2 text-sm leading-relaxed" style={{ color: "var(--muted)" }}>
              Plan kaydından yardım isteyebilirsin.
            </p>
            <Link href="/cocuk/yardim" className="mt-4 block">
              <Button variant="secondary">Yardımlarıma git</Button>
            </Link>
          </Panel>
        )}

        <div className="grid grid-cols-2 gap-3">
          <Link
            href="/cocuk/gunluk"
            className="inline-flex min-h-12 items-center justify-center rounded-2xl px-3 text-center text-sm font-semibold"
            style={{ border: "1px solid var(--line)", background: "var(--surface)" }}
          >
            Günlüğüm
          </Link>
          <Link
            href="/cocuk/hedefler"
            className="inline-flex min-h-12 items-center justify-center rounded-2xl px-3 text-center text-sm font-semibold"
            style={{ border: "1px solid var(--line)", background: "var(--surface)" }}
          >
            Hedeflerim
          </Link>
        </div>
      </div>
    </Shell>
  );
}
