import Link from "next/link";
import { redirect } from "next/navigation";
import {
  BoardPlanView,
  PlanningViewTabs,
} from "@/components/board-plan-view";
import { PlanParentNotice } from "@/components/plan-home-panels";
import { Button, Panel, Shell } from "@/components/ui";
import { WeekPlanView } from "@/components/week-plan-view";
import { getWeekPlanForChild } from "@/lib/plan";
import { getAppSession, getChildProfileForUser } from "@/lib/session";

export default async function ChildWeekPage({
  searchParams,
}: {
  searchParams: Promise<{ weekStart?: string; gun?: string; view?: string }>;
}) {
  const session = await getAppSession();
  if (!session || session.user.role !== "CHILD") redirect("/cocuk/giris");

  const child = await getChildProfileForUser(session.user.id);
  if (!child) redirect("/cocuk/giris");
  if (child.onboardingStep !== "COMPLETE") redirect("/cocuk");

  const params = await searchParams;
  const view = params.view === "pano" ? "pano" : "hafta";
  const week = await getWeekPlanForChild(session.user.id, params.weekStart);

  return (
    <Shell
      title="Planım"
      subtitle="Ödevler, sınavlar ve çalışma adımların. Hafta ve Pano aynı kayıtları gösterir."
      withChildNav
    >
      <div className="space-y-4">
        <PlanParentNotice />
        <Link href="/cocuk/plan/yeni" className="block">
          <Button>Plan ekle</Button>
        </Link>
        <PlanningViewTabs weekStart={week.weekStart} view={view} />
        <Panel>
          {view === "pano" ? (
            <BoardPlanView week={week} />
          ) : (
            <WeekPlanView week={week} initialSelectedDate={params.gun || week.today} />
          )}
        </Panel>
      </div>
    </Shell>
  );
}
