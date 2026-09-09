import { redirect } from "next/navigation";
import { finishChildOnboardingAction } from "@/app/actions";
import { Button, Panel, Shell } from "@/components/ui";
import { getAppSession, getChildProfileForUser } from "@/lib/session";

export default async function ChildExplanationPage() {
  const session = await getAppSession();
  if (!session || session.user.role !== "CHILD") redirect("/cocuk/giris");

  const child = await getChildProfileForUser(session.user.id);
  if (!child) redirect("/cocuk/giris");
  if (child.onboardingStep === "AVATAR") redirect("/cocuk/onboarding");
  if (child.onboardingStep === "COMPLETE") redirect("/cocuk/ana");

  return (
    <Shell title="Burası senin alanın">
      <Panel>
        <p className="text-lg leading-relaxed">
          Günlüğünden paylaşacaklarını sen seçersin. Planına eklediğin işleri velin görebilir.
        </p>
        <form action={finishChildOnboardingAction} className="mt-6">
          <Button type="submit">Ana ekranıma git</Button>
        </form>
      </Panel>
    </Shell>
  );
}
