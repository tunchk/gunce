import Link from "next/link";
import { redirect } from "next/navigation";
import { Button, Panel, Shell } from "@/components/ui";
import { WeekPlanView } from "@/components/week-plan-view";
import { getParentWeekPlan } from "@/lib/plan";
import { getAppSession, getParentFamilyContext } from "@/lib/session";

export default async function ParentPlanPage({
  searchParams,
}: {
  searchParams: Promise<{ weekStart?: string }>;
}) {
  const session = await getAppSession();
  if (!session || session.user.role !== "PARENT") redirect("/giris");

  const membership = await getParentFamilyContext(session.user.id);
  if (!membership) redirect("/veli/onboarding");
  if (membership.family.onboardingStep !== "COMPLETE") redirect("/veli");

  const params = await searchParams;
  const data = await getParentWeekPlan(session.user.id, params.weekStart);
  const childPlan = data.children[0];

  return (
    <Shell
      title="Haftanın planı"
      subtitle="Çocuğunun eklediği planı görebilirsin; düzenleme çocuğa aittir."
      wide
    >
      <div className="space-y-4">
        {!childPlan ? (
          <Panel>
            <p className="text-sm leading-relaxed" style={{ color: "var(--muted)" }}>
              Henüz görüntülenecek bir plan yok.
            </p>
          </Panel>
        ) : (
          <Panel>
            <p className="mb-4 text-sm font-semibold">{childPlan.childDisplayName}</p>
            <WeekPlanView
              week={{
                today: childPlan.today,
                weekStart: childPlan.weekStart,
                weekEnd: childPlan.weekEnd,
                days: childPlan.days,
                unscheduled: childPlan.unscheduled,
                missed: childPlan.missed,
              }}
              readOnly
            />
          </Panel>
        )}
        <Link href="/veli/ana" className="block">
          <Button variant="ghost">Ana sayfaya dön</Button>
        </Link>
      </div>
    </Shell>
  );
}
