import { redirect } from "next/navigation";
import { ChildProfileForm } from "@/components/child-profile-form";
import { Panel, Shell } from "@/components/ui";
import { getAppSession, getParentFamilyContext } from "@/lib/session";

export default async function ParentOnboardingPage() {
  const session = await getAppSession();
  if (!session || session.user.role !== "PARENT") redirect("/giris");

  const membership = await getParentFamilyContext(session.user.id);
  if (membership?.family.onboardingStep === "EXPLANATION") {
    redirect("/veli/onboarding/aciklama");
  }
  if (membership?.family.onboardingStep === "PAIRING") {
    redirect("/veli/onboarding/eslestirme");
  }
  if (membership?.family.onboardingStep === "COMPLETE") {
    redirect("/veli/ana");
  }

  const child = membership?.family.children[0];

  return (
    <Shell
      title="Çocuğunun profili"
      subtitle="Yalnızca görünen ad, yaş grubu ve saat dilimi yeterli. Doğum tarihi veya adres istemiyoruz."
    >
      <Panel>
        <ChildProfileForm
          defaults={{
            displayName: child?.displayName ?? "",
            ageGroup: child?.ageGroup ?? "AGE_9_11",
            timeZone: child?.timeZone ?? "Europe/Istanbul",
          }}
        />
      </Panel>
    </Shell>
  );
}
