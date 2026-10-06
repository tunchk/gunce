import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { HelpRequestStatusChip } from "@/components/help-child-actions";
import { CommitmentEditor } from "@/components/plan-editors";
import { Button, Panel, Shell } from "@/components/ui";
import { getActiveHelpForPlanItem } from "@/lib/help";
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

  const help = await getActiveHelpForPlanItem({
    childUserId: session.user.id,
    commitmentId: id,
  });

  return (
    <Shell title={data.commitment.title} subtitle="Ödev, sınav veya etkinliği düzenle." withChildNav>
      <div className="space-y-4">
        <Panel>
          <CommitmentEditor
            commitment={data.commitment}
            studySteps={data.studySteps}
          />
        </Panel>

        <Panel>
          <h2 className="text-lg font-semibold">Yardım</h2>
          {help ? (
            <div className="mt-3 space-y-3">
              <HelpRequestStatusChip statusLabel={help.statusLabel} />
              <Link href={`/cocuk/yardim/${help.id}`} className="block">
                <Button variant="secondary">Yardım isteğine bak</Button>
              </Link>
            </div>
          ) : (
            <div className="mt-3 space-y-3">
              <p className="text-sm leading-relaxed" style={{ color: "var(--muted)" }}>
                İstersen velinden yardım isteyebilirsin.
              </p>
              <Link
                href={`/cocuk/yardim/yeni?commitmentId=${data.commitment.id}`}
                className="block"
              >
                <Button variant="secondary">Yardım iste</Button>
              </Link>
            </div>
          )}
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
