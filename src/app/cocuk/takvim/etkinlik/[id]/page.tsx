import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { FamilyEventForm } from "@/components/family-event-form";
import { Panel, Shell } from "@/components/ui";
import { FamilyEventError, getFamilyEvent } from "@/lib/family-events";
import { formatDayLabelTr } from "@/lib/plan-dates";
import { getAppSession, getChildProfileForUser } from "@/lib/session";

export default async function ChildFamilyEventDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await getAppSession();
  if (!session || session.user.role !== "CHILD") redirect("/cocuk/giris");
  const child = await getChildProfileForUser(session.user.id);
  if (!child || child.onboardingStep !== "COMPLETE") redirect("/cocuk");

  const { id } = await params;
  let event;
  try {
    event = await getFamilyEvent({
      viewerUserId: session.user.id,
      viewerRole: "CHILD",
      eventId: id,
    });
  } catch (error) {
    if (error instanceof FamilyEventError && error.code === "NOT_FOUND") notFound();
    throw error;
  }

  return (
    <Shell title={event.title} subtitle={formatDayLabelTr(event.eventDate)} withChildNav>
      <div className="space-y-4">
        {event.canEdit ? (
          <Panel>
            <FamilyEventForm
              mode="edit"
              apiBase="/api/child/family-events"
              cancelHref="/cocuk/haftam?view=aile"
              initial={event}
            />
          </Panel>
        ) : (
          <Panel>
            <p className="text-sm font-semibold">{event.eventTypeLabel}</p>
            <p className="mt-2 text-sm" style={{ color: "var(--muted)" }}>
              {event.startTimeLocal
                ? `${event.startTimeLocal}${event.endTimeLocal ? `–${event.endTimeLocal}` : ""}`
                : "Saat belirtilmedi"}
              {" · "}
              {event.createdByName}
            </p>
            {event.note ? (
              <p className="mt-3 text-sm leading-relaxed">{event.note}</p>
            ) : null}
            {event.cancelledAt ? (
              <p className="mt-3 text-sm" style={{ color: "var(--muted)" }}>
                İptal edildi.
              </p>
            ) : (
              <p className="mt-3 text-sm" style={{ color: "var(--muted)" }}>
                Bu etkinliği yalnızca ekleyen kişi düzenleyebilir.
              </p>
            )}
          </Panel>
        )}
        <Link
          href="/cocuk/haftam?view=aile"
          className="inline-flex min-h-12 items-center font-semibold underline"
        >
          Aile takvimine dön
        </Link>
      </div>
    </Shell>
  );
}
