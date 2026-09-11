import Link from "next/link";
import { redirect } from "next/navigation";
import { signOutAction } from "@/app/actions";
import { ChildSelector } from "@/components/child-selector";
import { EmailVerificationReminder } from "@/components/email-verification-reminder";
import { ParentSharedSections } from "@/components/parent-shared-sections";
import { Button, Panel, Shell } from "@/components/ui";
import { avatarEmoji } from "@/lib/constants";
import { listParentSharedContent } from "@/lib/journal";
import { getParentWeekPlan } from "@/lib/plan";
import { getParentGoals } from "@/lib/goal";
import { formatDayLabelTr } from "@/lib/plan-dates";
import { commitmentTypeLabel } from "@/lib/plan-ui";
import { resolveParentChildContext } from "@/lib/parent-child-context";
import { getAppSession } from "@/lib/session";

export default async function ParentHomePage() {
  const session = await getAppSession();
  if (!session || session.user.role !== "PARENT") redirect("/giris");

  const ctx = await resolveParentChildContext(session.user.id);
  if (!ctx.child) redirect("/veli/onboarding");
  if (ctx.needsOnboarding) redirect("/veli");

  const child = ctx.child;

  const [shared, plan, goalsData] = await Promise.all([
    listParentSharedContent(session.user.id),
    getParentWeekPlan(session.user.id),
    getParentGoals(session.user.id),
  ]);

  const messages = shared.messages.filter((m) => m.childId === child.id);
  const supportRequests = shared.supportRequests.filter((m) => m.childId === child.id);

  const childPlan = plan.children.find((c) => c.childId === child.id);
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

  const childGoals =
    goalsData.children.find((c) => c.childId === child.id)?.goals ?? [];
  const activeGoals = childGoals.filter((g) => g.status === "ACTIVE");

  return (
    <Shell
      title={`Merhaba, ${session.user.name}`}
      subtitle="Yalnızca seninle paylaşılan içerikler ve bu çocuğun planı burada görünür."
      wide
      headerAction={
        <Link
          href="/veli/ayarlar"
          className="inline-flex min-h-11 items-center justify-center rounded-2xl px-3 text-sm font-semibold"
          style={{ border: "1px solid var(--line)" }}
        >
          Ayarlar
        </Link>
      }
    >
      <div className="space-y-4">
        {!session.user.emailVerified ? (
          <EmailVerificationReminder email={session.user.email} />
        ) : null}

        <Panel>
          <ChildSelector
            childrenOptions={ctx.accesses.map((a) => ({
              id: a.child.id,
              displayName: a.child.displayName,
            }))}
            selectedId={child.id}
          />
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <span className="text-3xl" aria-hidden>
              {avatarEmoji(child.avatarKey)}
            </span>
            <div>
              <p className="font-semibold">{child.displayName}</p>
              <p className="text-sm" style={{ color: "var(--muted)" }}>
                Eşleştirme ve veliler Ayarlar’da.
              </p>
            </div>
          </div>
        </Panel>

        <ParentSharedSections
          messages={messages}
          supportRequests={supportRequests}
        />

        <Panel>
          <h2 className="text-lg font-semibold">Haftanın planı</h2>
          <p className="mt-2 text-sm leading-relaxed" style={{ color: "var(--muted)" }}>
            Salt okunur. Günlük yazıları buraya karışmaz.
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
              {upcoming.slice(0, 3).map((item) => (
                <li
                  key={`${item.date}-${item.title}`}
                  className="text-sm leading-relaxed"
                >
                  <span className="font-medium">{item.label}:</span> {item.title}{" "}
                  <span style={{ color: "var(--muted)" }}>
                    ({formatDayLabelTr(item.date)})
                  </span>
                </li>
              ))}
            </ul>
          )}
          <div className="mt-4">
            <Link href="/veli/plan">
              <Button variant="secondary">Tüm planı gör</Button>
            </Link>
          </div>
        </Panel>

        <Panel>
          <h2 className="text-lg font-semibold">Hedefler</h2>
          <p className="mt-2 text-sm leading-relaxed" style={{ color: "var(--muted)" }}>
            Salt okunur özet.
          </p>
          {activeGoals.length === 0 ? (
            <p className="mt-3 text-sm" style={{ color: "var(--muted)" }}>
              Aktif hedef yok.
            </p>
          ) : (
            <ul className="mt-3 space-y-2">
              {activeGoals.slice(0, 3).map((g) => (
                <li key={g.id} className="text-sm font-medium">
                  {g.title}
                </li>
              ))}
            </ul>
          )}
          <div className="mt-4">
            <Link href="/veli/hedefler">
              <Button variant="secondary">Hedefleri gör</Button>
            </Link>
          </div>
        </Panel>

        <form action={signOutAction}>
          <Button type="submit" variant="ghost">
            Çıkış yap
          </Button>
        </form>
      </div>
    </Shell>
  );
}
