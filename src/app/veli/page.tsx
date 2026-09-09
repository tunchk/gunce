import { redirect } from "next/navigation";
import { getAppSession, getParentFamilyContext } from "@/lib/session";

export default async function ParentIndexPage() {
  const session = await getAppSession();
  if (!session || session.user.role !== "PARENT") {
    redirect("/giris");
  }

  const membership = await getParentFamilyContext(session.user.id);
  if (!membership) {
    redirect("/veli/onboarding");
  }

  const step = membership.family.onboardingStep;
  if (step === "CHILD_PROFILE") redirect("/veli/onboarding");
  if (step === "EXPLANATION") redirect("/veli/onboarding/aciklama");
  if (step === "PAIRING") redirect("/veli/onboarding/eslestirme");

  redirect("/veli/ana");
}
