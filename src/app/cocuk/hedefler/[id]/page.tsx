import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { GoalDetailEditor, GoalParentNotice } from "@/components/goal-panels";
import { Panel, Shell } from "@/components/ui";
import { getGoalDetail } from "@/lib/goal";
import { PlanError } from "@/lib/plan";
import { getAppSession, getChildProfileForUser } from "@/lib/session";

export default async function GoalDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ addStep?: string }>;
}) {
  const session = await getAppSession();
  if (!session || session.user.role !== "CHILD") redirect("/cocuk/giris");

  const child = await getChildProfileForUser(session.user.id);
  if (!child) redirect("/cocuk/giris");
  if (child.onboardingStep !== "COMPLETE") redirect("/cocuk");

  const { id } = await params;
  const sp = await searchParams;
  let goal;
  try {
    goal = await getGoalDetail(session.user.id, id);
  } catch (error) {
    if (error instanceof PlanError && error.code === "NOT_FOUND") notFound();
    throw error;
  }

  return (
    <Shell title={goal.title} subtitle="Hedefini düzenle, küçük adımlar ekle veya tamamla.">
      <div className="space-y-4">
        <GoalParentNotice />
        <Panel>
          <GoalDetailEditor initial={goal} offerAddStep={sp.addStep === "1"} />
        </Panel>
        <Link
          href="/cocuk/hedefler"
          className="inline-flex min-h-12 items-center text-sm font-semibold underline"
        >
          Hedeflerime dön
        </Link>
      </div>
    </Shell>
  );
}
