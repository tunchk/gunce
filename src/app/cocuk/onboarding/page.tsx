import { redirect } from "next/navigation";
import { AvatarPicker } from "@/components/avatar-picker";
import { Panel, Shell } from "@/components/ui";
import { getAppSession, getChildProfileForUser } from "@/lib/session";

export default async function ChildOnboardingAvatarPage() {
  const session = await getAppSession();
  if (!session || session.user.role !== "CHILD") redirect("/cocuk/giris");

  const child = await getChildProfileForUser(session.user.id);
  if (!child) redirect("/cocuk/giris");
  if (child.onboardingStep === "EXPLANATION") redirect("/cocuk/onboarding/aciklama");
  if (child.onboardingStep === "COMPLETE") redirect("/cocuk/ana");

  return (
    <Shell title={`Merhaba, ${child.displayName}!`} subtitle="Kendine bir avatar seç.">
      <Panel>
        <AvatarPicker current={child.avatarKey} />
      </Panel>
    </Shell>
  );
}
