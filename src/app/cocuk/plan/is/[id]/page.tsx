import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { CommitmentEditor } from "@/components/plan-editors";
import { Panel, Shell } from "@/components/ui";
import { getCommitment, PlanError } from "@/lib/plan";
import { getAppSession, getChildProfileForUser } from "@/lib/session";

export default async function CommitmentDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await getAppSession();
  if (!session || session.user.role !== "CHILD") redirect("/cocuk/giris");

  const child = await getChildProfileForUser(session.user.id);
  if (!child) redirect("/cocuk/giris");
  if (child.onboardingStep !== "COMPLETE") redirect("/cocuk");

  const { id } = await params;
  let data;
  try {
    data = await getCommitment(session.user.id, id);
  } catch (error) {
    if (error instanceof PlanError && error.code === "NOT_FOUND") notFound();
    throw error;
  }

  return (
    <Shell title={data.commitment.title} subtitle="Ödev, sınav veya etkinliği düzenle." withChildNav>
      <div className="space-y-4">
        <Panel>
          <CommitmentEditor
            commitment={data.commitment}
            studySteps={data.studySteps}
          />
        </Panel>
        <Link
          href="/cocuk/haftam"
          className="inline-flex min-h-12 items-center text-sm font-semibold underline"
        >
          Planıma dön
        </Link>
      </div>
    </Shell>
  );
}
