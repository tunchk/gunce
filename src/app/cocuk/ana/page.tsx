import Link from "next/link";
import { redirect } from "next/navigation";
import { signOutAction } from "@/app/actions";
import { NextStudyStepPanel, PlanParentNotice } from "@/components/plan-home-panels";
import { Button, ChildSettingsLink, Panel, Shell } from "@/components/ui";
import { avatarEmoji } from "@/lib/constants";
import {
  getNextStudyStepForToday,
  getWeekPlanForChild,
} from "@/lib/plan";
import { formatDayLabelTr } from "@/lib/plan-dates";
import { getAppSession, getChildProfileForUser } from "@/lib/session";

export default async function ChildHomePage() {
  const session = await getAppSession();
  if (!session || session.user.role !== "CHILD") redirect("/cocuk/giris");

  const child = await getChildProfileForUser(session.user.id);
  if (!child) redirect("/cocuk/giris");
  if (child.onboardingStep !== "COMPLETE") redirect("/cocuk");

  const [nextStep, week] = await Promise.all([
    getNextStudyStepForToday(session.user.id),
    getWeekPlanForChild(session.user.id),
  ]);

  const openSteps = week.days.reduce(
    (n, day) => n + day.studySteps.filter((s) => s.status !== "DONE").length,
    0,
  );
  const openCommitments = week.days.reduce(
    (n, day) => n + day.commitments.filter((c) => !c.completedAt).length,
    0,
  );

  return (
    <Shell
      title={`${avatarEmoji(child.avatarKey)} ${child.displayName}`}
      subtitle="Bugün nasılsın?"
      withChildNav
      headerAction={<ChildSettingsLink />}
    >
      <div className="space-y-4">
        <PlanParentNotice />

        <Panel>
          <h2 className="text-xl font-semibold">Günümü anlat</h2>
          <p className="mt-2 text-sm leading-relaxed" style={{ color: "var(--muted)" }}>
            Bugününü yaz veya sesle anlat. İstersen sonra paylaşır veya planına eklersin.
          </p>
          <Link href="/cocuk/gunluk/yeni" className="mt-4 block">
            <Button>Günümü anlat</Button>
          </Link>
        </Panel>

        <Panel>
          <NextStudyStepPanel step={nextStep} compact />
        </Panel>

        <Panel>
          <h2 className="text-lg font-semibold">Bu hafta</h2>
          <p className="mt-1 text-sm" style={{ color: "var(--muted)" }}>
            {formatDayLabelTr(week.weekStart)} – {formatDayLabelTr(week.weekEnd)}
          </p>
          <p className="mt-3 text-sm leading-relaxed">
            {openCommitments === 0 && openSteps === 0
              ? "Bu hafta için henüz planlanmış bir iş yok."
              : [
                  openCommitments > 0
                    ? `${openCommitments} ödev/sınav/etkinlik`
                    : null,
                  openSteps > 0 ? `${openSteps} açık çalışma adımı` : null,
                ]
                  .filter(Boolean)
                  .join(" · ")}
          </p>
          <Link href="/cocuk/haftam" className="mt-4 block">
            <Button variant="secondary">Haftalık plana git</Button>
          </Link>
        </Panel>

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
