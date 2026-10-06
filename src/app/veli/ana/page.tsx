import Link from "next/link";
import { redirect } from "next/navigation";
import { signOutAction } from "@/app/actions";
import { ChildSelector } from "@/components/child-selector";
import { EmailVerificationReminder } from "@/components/email-verification-reminder";
import { NotificationBell } from "@/components/notification-bell";
import { ParentSharedSections } from "@/components/parent-shared-sections";
import { Button, Panel, Shell } from "@/components/ui";
import { avatarEmoji } from "@/lib/constants";
import { listParentSharedContent } from "@/lib/journal";
import { listParentHelpInbox } from "@/lib/help";
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

  const [shared, plan, goalsData, helpInbox] = await Promise.all([
    listParentSharedContent(session.user.id),
    getParentWeekPlan(session.user.id),
    getParentGoals(session.user.id),
    listParentHelpInbox(session.user.id, child.id),
  ]);

  const messages = shared.messages.filter((m) => m.childId === child.id);
  const supportRequests = shared.supportRequests.filter((m) => m.childId === child.id);

  const childPlan = plan.children.find((c) => c.childId === child.id);
  const upcoming: {
    label: string;
    title: string;
    date: string;
    href: string;
  }[] = [];
  if (childPlan) {
    for (const day of childPlan.days) {
      for (const c of day.commitments) {
        if (c.completedAt) continue;
        upcoming.push({
          label: commitmentTypeLabel(c.type),
          title: c.title,
          date: day.date,
          href: `/veli/plan/is/${c.id}`,
        });
      }
      for (const s of day.studySteps) {
        if (s.status === "DONE") continue;
        upcoming.push({
          label: "Çalışma",
          title: s.title,
          date: day.date,
          href: `/veli/plan/adim/${s.id}`,
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
      subtitle="Yaklaşan plan ve çocuğunun seninle paylaştıkları."
      wide
      headerAction={
        <div className="flex items-center gap-2">
          <NotificationBell href="/veli/bildirimler" />
          <Link
            href="/veli/ayarlar"
            className="inline-flex min-h-11 items-center justify-center rounded-2xl px-3 text-sm font-semibold"
            style={{ border: "1px solid var(--line)" }}
          >
            Ayarlar
          </Link>
        </div>
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

        {helpInbox.waiting.length > 0 ? (
          <Panel>
            <h2 className="text-lg font-semibold">Yardım bekleyen</h2>
            <ul className="mt-3 space-y-3">
              {helpInbox.waiting.slice(0, 3).map((r) => (
                <li key={r.id} className="text-sm leading-relaxed">
                  <p className="font-medium">{r.planItem.title}</p>
                  <p style={{ color: "var(--muted)" }}>{r.helpTypeLabel}</p>
                  <Link href={`/veli/yardim/${r.id}`} className="mt-2 inline-block">
                    <Button variant="secondary">Yardım edebilirim</Button>
                  </Link>
                </li>
              ))}
            </ul>
            <div className="mt-4">
              <Link href="/veli/yardim">
                <Button variant="ghost">Tüm yardımları gör</Button>
              </Link>
            </div>
          </Panel>
        ) : (
          <Panel>
            <h2 className="text-lg font-semibold">Yardım</h2>
            <p className="mt-2 text-sm" style={{ color: "var(--muted)" }}>
              Bekleyen yardım isteği yok.
            </p>
            <div className="mt-4">
              <Link href="/veli/yardim">
                <Button variant="secondary">Yardım alanına git</Button>
              </Link>
            </div>
          </Panel>
        )}

        <Panel>
          <h2 className="text-lg font-semibold">Aile takvimi</h2>
          <p className="mt-2 text-sm leading-relaxed" style={{ color: "var(--muted)" }}>
            Ortak etkinlikler, planlanan yardımlar ve haftalık plan bir arada.
          </p>
          <div className="mt-4">
            <Link href="/veli/takvim">
              <Button variant="secondary">Aile takvimini aç</Button>
            </Link>
          </div>
        </Panel>

        <Panel>
          <h2 className="text-lg font-semibold">Yaklaşan plan</h2>
          <p className="mt-2 text-sm leading-relaxed" style={{ color: "var(--muted)" }}>
            Salt okunur. Günlük yazıları buraya karışmaz; tamamlanma notları çocuğa özeldir.
          </p>
          {childPlan ? (
            <p className="mt-2 text-sm" style={{ color: "var(--muted)" }}>
              {formatDayLabelTr(childPlan.weekStart)} – {formatDayLabelTr(childPlan.weekEnd)}
            </p>
          ) : null}
          {upcoming.length === 0 ? (
            <p className="mt-3 text-sm" style={{ color: "var(--muted)" }}>
              Bu hafta için listelenecek ödev, sınav veya çalışma adımı yok.
            </p>
          ) : (
            <ul className="mt-3 space-y-2">
              {upcoming.slice(0, 6).map((item) => (
                <li
                  key={`${item.href}-${item.date}`}
                  className="text-sm leading-relaxed"
                >
                  <Link href={item.href} className="font-medium underline">
                    {item.label}: {item.title}
                  </Link>{" "}
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

        <ParentSharedSections
          messages={messages}
          supportRequests={supportRequests}
        />

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
