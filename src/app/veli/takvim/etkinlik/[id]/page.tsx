import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { FamilyEventForm } from "@/components/family-event-form";
import { Panel, Shell } from "@/components/ui";
import { FamilyEventError, getFamilyEvent } from "@/lib/family-events";
import { formatDayLabelTr } from "@/lib/plan-dates";
import { getAppSession } from "@/lib/session";

export default async function ParentFamilyEventDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await getAppSession();
  if (!session || session.user.role !== "PARENT") redirect("/giris");

  const { id } = await params;
  let event;
  try {
    event = await getFamilyEvent({
      viewerUserId: session.user.id,
      viewerRole: "PARENT",
      eventId: id,
    });
  } catch (error) {
    if (error instanceof FamilyEventError && error.code === "NOT_FOUND") notFound();
    throw error;
  }

  return (
    <Shell title={event.title} subtitle={formatDayLabelTr(event.eventDate)}>
      <div className="space-y-4">
        {event.canEdit ? (
          <Panel>
            <FamilyEventForm
              mode="edit"
              apiBase="/api/parent/family-events"
              cancelHref="/veli/takvim"
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
            <p className="mt-3 text-sm" style={{ color: "var(--muted)" }}>
              Bu etkinliği yalnızca ekleyen kişi düzenleyebilir.
            </p>
          </Panel>
        )}
        <Link href="/veli/takvim" className="inline-flex min-h-12 items-center font-semibold underline">
          Aile takvimine dön
        </Link>
      </div>
    </Shell>
  );
}
