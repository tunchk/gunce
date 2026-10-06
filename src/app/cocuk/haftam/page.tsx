import Link from "next/link";
import { redirect } from "next/navigation";
import { BoardPlanView } from "@/components/board-plan-view";
import { FamilyCoordinationWeekView } from "@/components/family-coordination-week";
import { PlanParentNotice } from "@/components/plan-home-panels";
import { Button, Panel, Shell } from "@/components/ui";
import { WeekPlanView } from "@/components/week-plan-view";
import { getFamilyCoordinationWeek } from "@/lib/family-calendar";
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
  const view = params.view === "pano" ? "pano" : params.view === "aile" ? "aile" : "hafta";
  const week = await getWeekPlanForChild(session.user.id, params.weekStart);
  const sessions = await listChildHelpSessions(session.user.id, {
    fromDate: week.weekStart,
    toDate: week.weekEnd,
  });
  const activeSessions = sessions.filter((s) => s.status === "ACCEPTED");
  const coordination =
    view === "aile"
      ? await getFamilyCoordinationWeek({
          viewerUserId: session.user.id,
          viewerRole: "CHILD",
          weekStartIso: params.weekStart,
        })
      : null;

  const weekParams = new URLSearchParams();
  if (week.weekStart) weekParams.set("weekStart", week.weekStart);
  const haftaHref = `/cocuk/haftam?${weekParams.toString()}`;
  const aileParams = new URLSearchParams(weekParams);
  aileParams.set("view", "aile");
  const aileHref = `/cocuk/haftam?${aileParams.toString()}`;
  const panoParams = new URLSearchParams(weekParams);
  panoParams.set("view", "pano");
  const panoHref = `/cocuk/haftam?${panoParams.toString()}`;

  return (
    <Shell
      title="Haftam"
      subtitle="Bu haftanın planı, yardımları ve aile etkinlikleri."
      withChildNav
      planWide
    >
      <div className="space-y-4">
        <PlanParentNotice />
        <div className="flex flex-wrap gap-2">
          <Link href="/cocuk/plan/yeni" className="block flex-1 min-w-[10rem]">
            <Button>Plan ekle</Button>
          </Link>
          <Link href="/cocuk/takvim/yeni" className="block flex-1 min-w-[10rem]">
            <Button variant="secondary">Aile etkinliği ekle</Button>
          </Link>
        </div>

        {view !== "aile" && activeSessions.length > 0 ? (
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
            <Link href={aileHref} className="mt-3 inline-flex text-sm font-semibold underline">
              Aile takviminde gör
            </Link>
          </Panel>
        ) : null}

        {view === "pano" ? (
          <p className="text-sm" style={{ color: "var(--muted)" }}>
            Duruma göre görünüm.{" "}
            <Link href={haftaHref} className="font-semibold underline">
              Hafta takvimine dön
            </Link>
            {" · "}
            <Link href={aileHref} className="font-semibold underline">
              Aile takvimi
            </Link>
          </p>
        ) : view === "aile" ? (
          <p className="text-sm" style={{ color: "var(--muted)" }}>
            <Link href={haftaHref} className="font-semibold underline">
              Hafta planına dön
            </Link>
            {" · "}
            <Link href={panoHref} className="font-semibold underline">
              Duruma göre (Pano)
            </Link>
          </p>
        ) : (
          <p className="text-sm" style={{ color: "var(--muted)" }}>
            <Link href={aileHref} className="font-semibold underline">
              Aile takvimi
            </Link>
            {" · "}
            <Link href={panoHref} className="font-semibold underline">
              Duruma göre (Pano)
            </Link>
          </p>
        )}

        <Panel>
          {view === "pano" ? (
            <BoardPlanView week={week} />
          ) : view === "aile" && coordination ? (
            <FamilyCoordinationWeekView
              week={coordination}
              basePath="/cocuk/haftam"
              emptyFamilyCopy="Bu hafta aile takviminde ek bir plan yok."
            />
          ) : (
            <WeekPlanView week={week} initialSelectedDate={params.gun || week.today} />
          )}
        </Panel>
      </div>
    </Shell>
  );
}
