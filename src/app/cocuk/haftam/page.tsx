import Link from "next/link";
import { redirect } from "next/navigation";
import { BoardPlanView } from "@/components/board-plan-view";
import { PlanParentNotice } from "@/components/plan-home-panels";
import { Button, Panel, Shell } from "@/components/ui";
import { WeekPlanView } from "@/components/week-plan-view";
import { listChildHelpSessions } from "@/lib/help";
import { getWeekPlanForChild } from "@/lib/plan";
import { formatDayLabelTr } from "@/lib/plan-dates";
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
  const sessions = await listChildHelpSessions(session.user.id, {
    fromDate: week.weekStart,
    toDate: week.weekEnd,
  });
  const activeSessions = sessions.filter((s) => s.status === "ACCEPTED");

  const weekParams = new URLSearchParams();
  if (week.weekStart) weekParams.set("weekStart", week.weekStart);
  const haftaHref = `/cocuk/haftam?${weekParams.toString()}`;
  weekParams.set("view", "pano");
  const panoHref = `/cocuk/haftam?${weekParams.toString()}`;

  return (
    <Shell
      title="Haftam"
      subtitle="Bu haftanın ödev, sınav ve çalışma adımları."
      withChildNav
      planWide
    >
      <div className="space-y-4">
        <PlanParentNotice />
        <Link href="/cocuk/plan/yeni" className="block">
          <Button>Plan ekle</Button>
        </Link>

        {activeSessions.length > 0 ? (
          <Panel>
            <h2 className="text-lg font-semibold">Planlanan yardımlar</h2>
            <ul className="mt-3 space-y-2">
              {activeSessions.map((s) => (
                <li key={s.requestId} className="text-sm leading-relaxed">
                  <Link
                    href={`/cocuk/yardim/${s.requestId}`}
                    className="font-semibold underline"
                  >
                    {s.planItem.title}
                  </Link>{" "}
                  <span style={{ color: "var(--muted)" }}>
                    {formatDayLabelTr(s.proposedDate)} {s.proposedTimeLocal} ·{" "}
                    {s.guardianName}
                  </span>
                </li>
              ))}
            </ul>
          </Panel>
        ) : null}

        {view === "pano" ? (
          <p className="text-sm" style={{ color: "var(--muted)" }}>
            Duruma göre görünüm.{" "}
            <Link href={haftaHref} className="font-semibold underline">
              Hafta takvimine dön
            </Link>
          </p>
        ) : (
          <p className="text-sm" style={{ color: "var(--muted)" }}>
            <Link href={panoHref} className="font-semibold underline">
              Duruma göre (Pano)
            </Link>
          </p>
        )}

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
