import Link from "next/link";
import { redirect } from "next/navigation";
import { ChildSelector } from "@/components/child-selector";
import { FamilyCoordinationWeekView } from "@/components/family-coordination-week";
import { Button, Panel, Shell } from "@/components/ui";
import { getFamilyCoordinationWeek } from "@/lib/family-calendar";
import { resolveParentChildContext } from "@/lib/parent-child-context";
import { getAppSession } from "@/lib/session";

export default async function ParentFamilyCalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ weekStart?: string }>;
}) {
  const session = await getAppSession();
  if (!session || session.user.role !== "PARENT") redirect("/giris");

  const ctx = await resolveParentChildContext(session.user.id);
  if (!ctx.child) redirect("/veli/onboarding");
  if (ctx.needsOnboarding) redirect("/veli");

  const params = await searchParams;
  const week = await getFamilyCoordinationWeek({
    viewerUserId: session.user.id,
    viewerRole: "PARENT",
    childId: ctx.child.id,
    weekStartIso: params.weekStart,
  });

  return (
    <Shell
      title="Aile takvimi"
      subtitle={`${ctx.child.displayName} · plan, yardım ve ortak etkinlikler`}
      wide
    >
      <div className="space-y-4">
        <Panel>
          <ChildSelector
            childrenOptions={ctx.accesses.map((a) => ({
              id: a.child.id,
              displayName: a.child.displayName,
            }))}
            selectedId={ctx.child.id}
          />
        </Panel>

        <Link href="/veli/takvim/yeni">
          <Button>Aile etkinliği ekle</Button>
        </Link>

        <Panel>
          <FamilyCoordinationWeekView
            week={week}
            basePath="/veli/takvim"
            emptyFamilyCopy="Bu hafta için eklenmiş ortak bir etkinlik yok."
          />
        </Panel>

        <Link href="/veli/ana" className="inline-flex min-h-12 items-center font-semibold underline">
          Ana sayfaya dön
        </Link>
      </div>
    </Shell>
  );
}
