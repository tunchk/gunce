import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { NotificationBell } from "@/components/notification-bell";
import { ParentJournalAiPanels } from "@/components/parent-journal-ai-panels";
import { Panel, Shell } from "@/components/ui";
import { formatDiaryDate, getParentVisibleEntry, JournalError } from "@/lib/journal";
import { markJournalEntryNotificationsRead } from "@/lib/notifications";
import { getAppSession } from "@/lib/session";

type Props = { params: Promise<{ entryId: string }> };

export default async function ParentJournalDetailPage({ params }: Props) {
  const session = await getAppSession();
  if (!session || session.user.role !== "PARENT") redirect("/giris");
  const { entryId } = await params;

  let entry;
  try {
    entry = await getParentVisibleEntry(session.user.id, entryId);
  } catch (error) {
    if (error instanceof JournalError && error.code === "NOT_FOUND") notFound();
    throw error;
  }

  await markJournalEntryNotificationsRead({
    recipientUserId: session.user.id,
    entryId: entry.entryId,
  });

  return (
    <Shell
      title={entry.childDisplayName}
      subtitle={`${formatDiaryDate(new Date(`${entry.diaryDate}T00:00:00.000Z`))} · Kaydedilen günlük`}
      wide
      headerAction={
        <div className="flex items-center gap-2">
          <NotificationBell href="/veli/bildirimler" />
          <Link
            href="/veli/ana"
            className="inline-flex min-h-11 items-center justify-center rounded-2xl px-3 text-sm font-semibold"
            style={{ border: "1px solid var(--line)" }}
          >
            Ana
          </Link>
        </div>
      }
    >
      <div className="space-y-4">
        <Panel>
          <p className="text-sm" style={{ color: "var(--muted)" }}>
            Son güncelleme:{" "}
            {new Date(entry.updatedAt).toLocaleString("tr-TR")}
          </p>
          <h2 className="mt-3 text-lg font-semibold">Kaydedilen anlatım</h2>
          <p className="mt-3 whitespace-pre-wrap text-base leading-relaxed">
            {entry.body}
          </p>
        </Panel>

        <ParentJournalAiPanels entryId={entry.entryId} initialAi={entry.ai} />

        <p className="text-sm" style={{ color: "var(--muted)" }}>
          Bu ekran salt okunur.
        </p>
      </div>
    </Shell>
  );
}
