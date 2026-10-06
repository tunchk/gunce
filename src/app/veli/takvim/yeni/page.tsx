import { redirect } from "next/navigation";
import { FamilyEventForm } from "@/components/family-event-form";
import { Panel, Shell } from "@/components/ui";
import { calendarDateInTimeZone } from "@/lib/plan-dates";
import { resolveParentChildContext } from "@/lib/parent-child-context";
import { getAppSession } from "@/lib/session";

export default async function ParentNewFamilyEventPage() {
  const session = await getAppSession();
  if (!session || session.user.role !== "PARENT") redirect("/giris");

  const ctx = await resolveParentChildContext(session.user.id);
  if (!ctx.child) redirect("/veli/onboarding");
  if (ctx.needsOnboarding) redirect("/veli");

  const today = calendarDateInTimeZone(ctx.child.timeZone || "Europe/Istanbul");

  return (
    <Shell title="Aile etkinliği ekle" subtitle={ctx.child.displayName}>
      <Panel>
        <FamilyEventForm
          mode="create"
          apiBase="/api/parent/family-events"
          childId={ctx.child.id}
          cancelHref="/veli/takvim"
          initial={{ eventDate: today, eventType: "FAMILY" }}
        />
      </Panel>
    </Shell>
  );
}
