import Link from "next/link";
import { redirect } from "next/navigation";
import {
  GoalCard,
  GoalParentNotice,
  goalStatusLabel,
} from "@/components/goal-panels";
import { Button, Panel, Shell } from "@/components/ui";
import { listGoalsForChild } from "@/lib/goal";
import { getAppSession, getChildProfileForUser } from "@/lib/session";

export default async function ChildGoalsPage() {
  const session = await getAppSession();
  if (!session || session.user.role !== "CHILD") redirect("/cocuk/giris");

  const child = await getChildProfileForUser(session.user.id);
  if (!child) redirect("/cocuk/giris");
  if (child.onboardingStep !== "COMPLETE") redirect("/cocuk");

  const goals = await listGoalsForChild(session.user.id);

  return (
    <Shell title="Hedeflerim" subtitle="Uzun vadeli niyetlerini küçük adımlara böl.">
      <div className="space-y-4">
        <GoalParentNotice />
        <Link href="/cocuk/hedefler/yeni" className="block">
          <Button>Yeni hedef</Button>
        </Link>

        <Panel>
          <h2 className="text-lg font-semibold">Devam eden</h2>
          {goals.active.length === 0 ? (
            <p className="mt-2 text-sm" style={{ color: "var(--muted)" }}>
              Henüz aktif hedef yok. Küçük bir niyetle başlayabilirsin.
            </p>
          ) : (
            <ul className="mt-3 space-y-3">
              {goals.active.map((g) => (
                <li key={g.id}>
                  <GoalCard goal={g} />
                </li>
              ))}
            </ul>
          )}
        </Panel>

        {goals.achieved.length > 0 ? (
          <Panel>
            <h2 className="text-lg font-semibold">Ulaşılanlar</h2>
            <ul className="mt-3 space-y-3">
              {goals.achieved.map((g) => (
                <li key={g.id}>
                  <GoalCard goal={g} />
                </li>
              ))}
            </ul>
          </Panel>
        ) : null}

        {goals.archived.length > 0 ? (
          <Panel>
            <h2 className="text-lg font-semibold">Arşiv</h2>
            <p className="mt-1 text-sm" style={{ color: "var(--muted)" }}>
              Arşivlenen hedeflerin adımları haftalık planda kalmaya devam eder.
            </p>
            <ul className="mt-3 space-y-3">
              {goals.archived.map((g) => (
                <li key={g.id}>
                  <GoalCard goal={g} />
                  <p className="mt-1 text-xs" style={{ color: "var(--muted)" }}>
                    {goalStatusLabel(g.status)}
                  </p>
                </li>
              ))}
            </ul>
          </Panel>
        ) : null}

        <Link
          href="/cocuk/ana"
          className="inline-flex min-h-12 items-center text-sm font-semibold underline"
        >
          Ana sayfaya dön
        </Link>
      </div>
    </Shell>
  );
}
