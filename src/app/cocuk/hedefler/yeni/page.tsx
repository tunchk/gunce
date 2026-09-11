import Link from "next/link";
import { redirect } from "next/navigation";
import { GoalCreateForm, GoalParentNotice } from "@/components/goal-panels";
import { Panel, Shell } from "@/components/ui";
import { getAppSession, getChildProfileForUser } from "@/lib/session";

export default async function GoalCreatePage() {
  const session = await getAppSession();
  if (!session || session.user.role !== "CHILD") redirect("/cocuk/giris");

  const child = await getChildProfileForUser(session.user.id);
  if (!child) redirect("/cocuk/giris");
  if (child.onboardingStep !== "COMPLETE") redirect("/cocuk");

  return (
    <Shell title="Yeni hedef" subtitle="Başlık yeterli; istersen sonra küçük adımlar eklersin." withChildNav>
      <div className="space-y-4">
        <GoalParentNotice />
        <Panel>
          <GoalCreateForm />
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
