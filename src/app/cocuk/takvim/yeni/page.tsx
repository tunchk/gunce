import { redirect } from "next/navigation";
import { FamilyEventForm } from "@/components/family-event-form";
import { Panel, Shell } from "@/components/ui";
import { calendarDateInTimeZone } from "@/lib/plan-dates";
import { getAppSession, getChildProfileForUser } from "@/lib/session";

export default async function ChildNewFamilyEventPage() {
  const session = await getAppSession();
  if (!session || session.user.role !== "CHILD") redirect("/cocuk/giris");
  const child = await getChildProfileForUser(session.user.id);
  if (!child || child.onboardingStep !== "COMPLETE") redirect("/cocuk");

  const today = calendarDateInTimeZone(child.timeZone);

  return (
    <Shell title="Aile etkinliği ekle" subtitle="Takvimde herkes görür." withChildNav>
      <Panel>
        <FamilyEventForm
          mode="create"
          apiBase="/api/child/family-events"
          cancelHref="/cocuk/haftam?view=aile"
          initial={{ eventDate: today, eventType: "FAMILY" }}
        />
      </Panel>
    </Shell>
  );
}
