import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { StudyStepEditor } from "@/components/plan-editors";
import { Panel, Shell } from "@/components/ui";
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
  const linkables = await listCommitmentsForLinking(session.user.id);

  return (
    <Shell title={step.title} subtitle="Çalışma adımını düzenle veya başka güne taşı.">
      <div className="space-y-4">
        <Panel>
          <StudyStepEditor step={step} linkables={linkables} />
        </Panel>
        <Link
          href="/cocuk/haftam"
          className="inline-flex min-h-12 items-center text-sm font-semibold underline"
        >
          Haftama dön
        </Link>
      </div>
    </Shell>
  );
}
