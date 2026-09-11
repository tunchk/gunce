import Link from "next/link";
import { redirect } from "next/navigation";
import { PlanCreateForm } from "@/components/plan-create-form";
import { PlanParentNotice } from "@/components/plan-home-panels";
import { Panel, Shell } from "@/components/ui";
import { getAppSession, getChildProfileForUser } from "@/lib/session";

export default async function PlanCreatePage({
  searchParams,
}: {
  searchParams: Promise<{ related?: string; step?: string }>;
}) {
  const session = await getAppSession();
  if (!session || session.user.role !== "CHILD") redirect("/cocuk/giris");

  const child = await getChildProfileForUser(session.user.id);
  if (!child) redirect("/cocuk/giris");
  if (child.onboardingStep !== "COMPLETE") redirect("/cocuk");

  const params = await searchParams;

  return (
    <Shell title="Plan ekle" subtitle="Ne eklemek istediğini seç, sonra sadece gerekli alanları doldur.">
      <div className="space-y-4">
        <PlanParentNotice />
        <Panel>
          <PlanCreateForm
            prefillRelatedCommitmentId={params.related}
          />
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
