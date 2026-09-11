import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { PlanExtractReview } from "@/components/plan-extract-review";
import { Panel, Shell } from "@/components/ui";
import { getAiFeatureStatus } from "@/lib/ai";
import { getChildEntry, JournalError } from "@/lib/journal";
import {
  getLatestPlanExtractBatch,
  listOpenCommitmentsForExtract,
} from "@/lib/plan-extract";
import { getAppSession, getChildProfileForUser } from "@/lib/session";

type Props = { params: Promise<{ id: string }> };

export default async function PlanExtractPage({ params }: Props) {
  const session = await getAppSession();
  if (!session || session.user.role !== "CHILD") redirect("/cocuk/giris");
  const child = await getChildProfileForUser(session.user.id);
  if (!child || child.onboardingStep !== "COMPLETE") redirect("/cocuk");

  const { id } = await params;
  try {
    await getChildEntry(session.user.id, id);
  } catch (error) {
    if (error instanceof JournalError && error.code === "NOT_FOUND") notFound();
    throw error;
  }

  const features = getAiFeatureStatus();
  const batch = await getLatestPlanExtractBatch({
    childUserId: session.user.id,
    entryId: id,
  });
  const openCommitments = await listOpenCommitmentsForExtract({
    childUserId: session.user.id,
  });

  return (
    <Shell
      title="Plan önerileri"
      subtitle="Yazından çıkan adayları gözden geçir; seçtiklerini haftalık planına ekle."
    >
      <div className="space-y-4">
        <Panel>
          <PlanExtractReview
            entryId={id}
            extractAvailable={features.planExtractAvailable}
            initialBatch={batch}
            initialCommitments={openCommitments}
          />
        </Panel>
        <Link
          href={`/cocuk/gunluk/${id}`}
          className="inline-flex min-h-12 items-center font-semibold underline"
        >
          Günlük yazısına dön
        </Link>
      </div>
    </Shell>
  );
}
