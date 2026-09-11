import Link from "next/link";
import { redirect } from "next/navigation";
import { signOutAction } from "@/app/actions";
import { ParentSharedSections } from "@/components/parent-shared-sections";
import { Button, Panel, Shell } from "@/components/ui";
import { avatarEmoji } from "@/lib/constants";
import { listParentSharedContent } from "@/lib/journal";
import { getParentWeekPlan } from "@/lib/plan";
import { getParentGoals } from "@/lib/goal";
import { formatDayLabelTr } from "@/lib/plan-dates";
import { commitmentTypeLabel } from "@/lib/plan-ui";
import { getAppSession, getParentFamilyContext } from "@/lib/session";

export default async function ParentHomePage() {
  const session = await getAppSession();
  if (!session || session.user.role !== "PARENT") redirect("/giris");

  const membership = await getParentFamilyContext(session.user.id);
  if (!membership) redirect("/veli/onboarding");
  if (membership.family.onboardingStep !== "COMPLETE") redirect("/veli");

  const child = membership.family.children[0];
  if (!child) redirect("/veli/onboarding");

  const [shared, plan, goalsData] = await Promise.all([
    listParentSharedContent(session.user.id),
    getParentWeekPlan(session.user.id),
    getParentGoals(session.user.id),
  ]);

  const childPlan = plan.children[0];
  const upcoming: { label: string; title: string; date: string }[] = [];
  if (childPlan) {
    for (const day of childPlan.days) {
      for (const c of day.commitments) {
        if (c.completedAt) continue;
        upcoming.push({
          label: commitmentTypeLabel(c.type),
          title: c.title,
          date: day.date,
        });
      }
    }
  }

  return (
    <Shell
      title={`Merhaba, ${session.user.name}`}
      subtitle="Yalnızca çocuğunun seninle paylaştığı içerikler ve planı burada görünür."
      wide
    >
      <div className="space-y-4">
        <Panel>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <span className="text-3xl" aria-hidden>
                {avatarEmoji(child.avatarKey)}
              </span>
              <div>
                <p className="font-semibold">{child.displayName}</p>
                <p className="text-sm" style={{ color: "var(--muted)" }}>
                  Paylaşımlarını ve haftalık planını buradan takip edebilirsin.
                </p>
              </div>
            </div>
            <Link
              href="/veli/ayarlar"
              className="inline-flex min-h-11 items-center justify-center rounded-2xl px-4 text-sm font-semibold"
              style={{ border: "1px solid var(--line)" }}
            >
              Aile ayarları
            </Link>
          </div>
        </Panel>

        <Panel>
          <h2 className="text-lg font-semibold">Haftanın planı</h2>
          <p className="mt-2 text-sm leading-relaxed" style={{ color: "var(--muted)" }}>
            Planı çocuk yönetir. Sen yalnızca okuyabilirsin; günlük yazıları buraya karışmaz.
          </p>
          {childPlan ? (
            <p className="mt-2 text-sm" style={{ color: "var(--muted)" }}>
              {formatDayLabelTr(childPlan.weekStart)} – {formatDayLabelTr(childPlan.weekEnd)}
            </p>
          ) : null}
          {upcoming.length === 0 ? (
            <p className="mt-3 text-sm" style={{ color: "var(--muted)" }}>
              Bu hafta için yaklaşan ödev, sınav veya etkinlik yok.
            </p>
          ) : (
            <ul className="mt-3 space-y-2">
              {upcoming.slice(0, 5).map((item) => (
                <li
                  key={`${item.date}-${item.title}`}
                  className="rounded-2xl border px-3 py-3 text-sm"
                  style={{ borderColor: "var(--line)" }}
                >
                  <span className="font-semibold">{item.label}</span>
                  {" · "}
                  {item.title}
                  <span className="mt-1 block" style={{ color: "var(--muted)" }}>
                    {formatDayLabelTr(item.date)}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {childPlan && childPlan.missed.length > 0 ? (
            <p className="mt-3 text-sm" style={{ color: "var(--muted)" }}>
              Yeniden planlanacak {childPlan.missed.length} adım var.
            </p>
          ) : null}
          <Link href="/veli/plan" className="mt-4 block">
            <Button variant="secondary">Haftanın planını aç</Button>
          </Link>
        </Panel>

        <Panel>
          <h2 className="text-lg font-semibold">Hedefler</h2>
          <p className="mt-2 text-sm leading-relaxed" style={{ color: "var(--muted)" }}>
            Uzun vadeli hedefler salt okunur; günlük metinler buraya karışmaz.
          </p>
          {(() => {
            const childGoals = goalsData.children[0]?.goals ?? [];
            const active = childGoals.filter((g) => g.status === "ACTIVE");
            if (active.length === 0) {
              return (
                <p className="mt-3 text-sm" style={{ color: "var(--muted)" }}>
                  Aktif hedef yok.
                </p>
              );
            }
            return (
              <ul className="mt-3 space-y-2">
                {active.slice(0, 3).map((g) => (
                  <li
                    key={g.id}
                    className="rounded-2xl border px-3 py-3 text-sm"
                    style={{ borderColor: "var(--line)" }}
                  >
                    <span className="font-semibold">{g.title}</span>
                    <span className="mt-1 block" style={{ color: "var(--muted)" }}>
                      {g.progress.label}
                    </span>
                  </li>
                ))}
              </ul>
            );
          })()}
          <Link href="/veli/hedefler" className="mt-4 block">
            <Button variant="ghost">Hedefleri aç</Button>
          </Link>
        </Panel>

        <ParentSharedSections
          messages={shared.messages}
          supportRequests={shared.supportRequests}
        />

        <form action={signOutAction}>
          <Button type="submit" variant="ghost">
            Çıkış yap
          </Button>
        </form>
      </div>
    </Shell>
  );
}
