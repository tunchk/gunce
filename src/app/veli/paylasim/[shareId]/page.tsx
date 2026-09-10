import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ParentGuidancePanel } from "@/components/parent-shared-sections";
import { Button, Panel, Shell } from "@/components/ui";
import {
  formatDiaryDate,
  getParentShareDetail,
  JournalError,
} from "@/lib/journal";
import { getAppSession } from "@/lib/session";

type Props = { params: Promise<{ shareId: string }> };

export default async function ParentShareDetailPage({ params }: Props) {
  const session = await getAppSession();
  if (!session || session.user.role !== "PARENT") redirect("/giris");

  const { shareId } = await params;
  let share;
  try {
    share = await getParentShareDetail(session.user.id, shareId);
  } catch (error) {
    if (error instanceof JournalError && (error.code === "NOT_FOUND" || error.code === "GONE")) {
      notFound();
    }
    throw error;
  }

  return (
    <Shell
      title={share.childDisplayName}
      subtitle={formatDiaryDate(new Date(`${share.diaryDate}T00:00:00.000Z`))}
      wide
    >
      <div className="space-y-4">
        <Panel>
          <h2 className="text-lg font-semibold">Paylaşılan mesaj</h2>
          {share.parentMessage.trim() ? (
            <p className="mt-3 whitespace-pre-wrap text-base leading-relaxed">
              {share.parentMessage}
            </p>
          ) : (
            <p className="mt-3 text-sm" style={{ color: "var(--muted)" }}>
              Bu paylaşımda mesaj yok.
            </p>
          )}
        </Panel>

        <Panel>
          <h2 className="text-lg font-semibold">Çocuğunun destek isteği</h2>
          {share.supportRequest.trim() ? (
            <p className="mt-3 whitespace-pre-wrap text-base leading-relaxed">
              {share.supportRequest}
            </p>
          ) : (
            <p className="mt-3 text-sm" style={{ color: "var(--muted)" }}>
              Bu paylaşımda açık bir destek isteği yok.
            </p>
          )}
        </Panel>

        <Panel>
          <ParentGuidancePanel shareId={share.shareId} />
        </Panel>

        <Link href="/veli/ana">
          <Button variant="secondary">Paylaşımlara dön</Button>
        </Link>
      </div>
    </Shell>
  );
}
