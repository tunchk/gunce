import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { HelpRequestStatusChip } from "@/components/help-child-actions";
import { StudyStepEditor } from "@/components/plan-editors";
import { Button, Panel, Shell } from "@/components/ui";
import { getActiveHelpForPlanItem } from "@/lib/help";
import { getStudyStep, listCommitmentsForLinking, PlanError } from "@/lib/plan";
import { getAppSession, getChildProfileForUser } from "@/lib/session";

export default async function StudyStepDetailPage({
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
  let step;
  try {
    step = await getStudyStep(session.user.id, id);
  } catch (error) {
    if (error instanceof PlanError && error.code === "NOT_FOUND") notFound();
    throw error;
  }
  const [linkables, help] = await Promise.all([
    listCommitmentsForLinking(session.user.id),
    getActiveHelpForPlanItem({ childUserId: session.user.id, studyStepId: id }),
  ]);

  return (
    <Shell title={step.title} subtitle="Çalışma adımını düzenle veya başka güne taşı." withChildNav>
      <div className="space-y-4">
        <Panel>
          <StudyStepEditor step={step} linkables={linkables} />
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
              <Link href={`/cocuk/yardim/yeni?studyStepId=${step.id}`} className="block">
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
