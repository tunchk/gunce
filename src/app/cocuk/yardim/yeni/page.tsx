import Link from "next/link";
import { redirect } from "next/navigation";
import { HelpRequestForm } from "@/components/help-request-form";
import { Panel, Shell } from "@/components/ui";
import { getActiveHelpForPlanItem } from "@/lib/help";
import { getCommitment, getStudyStep, PlanError } from "@/lib/plan";
import { getAppSession, getChildProfileForUser } from "@/lib/session";

export default async function NewHelpRequestPage({
  searchParams,
}: {
  searchParams: Promise<{ studyStepId?: string; commitmentId?: string }>;
}) {
  const session = await getAppSession();
  if (!session || session.user.role !== "CHILD") redirect("/cocuk/giris");
  const child = await getChildProfileForUser(session.user.id);
  if (!child || child.onboardingStep !== "COMPLETE") redirect("/cocuk");

  const params = await searchParams;
  const studyStepId = params.studyStepId?.trim() || null;
  const commitmentId = params.commitmentId?.trim() || null;

  if (Boolean(studyStepId) === Boolean(commitmentId)) {
    redirect("/cocuk/haftam");
  }

  let planTitle = "";
  let backHref = "/cocuk/haftam";
  try {
    if (studyStepId) {
      const step = await getStudyStep(session.user.id, studyStepId);
      planTitle = step.title;
      backHref = `/cocuk/plan/adim/${step.id}`;
    } else if (commitmentId) {
      const data = await getCommitment(session.user.id, commitmentId);
      planTitle = data.commitment.title;
      backHref = `/cocuk/plan/is/${data.commitment.id}`;
    }
  } catch (error) {
    if (error instanceof PlanError) redirect("/cocuk/haftam");
    throw error;
  }

  const existing = await getActiveHelpForPlanItem({
    childUserId: session.user.id,
    studyStepId,
    commitmentId,
  });
  if (existing) {
    redirect(`/cocuk/yardim/${existing.id}`);
  }

  return (
    <Shell title="Yardım iste" subtitle="Velin teklif edebilir; sen seçersin." withChildNav>
      <div className="space-y-4">
        <Panel>
          <HelpRequestForm
            studyStepId={studyStepId ?? undefined}
            commitmentId={commitmentId ?? undefined}
            planTitle={planTitle}
          />
        </Panel>
        <Link href={backHref} className="inline-flex min-h-12 items-center font-semibold underline">
          Plana dön
        </Link>
      </div>
    </Shell>
  );
}
