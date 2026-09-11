import { redirect } from "next/navigation";
import {
  getAppSession,
  getParentAccessibleChildren,
  getParentFamilyContext,
} from "@/lib/session";

export default async function ParentIndexPage() {
  const session = await getAppSession();
  if (!session || session.user.role !== "PARENT") {
    redirect("/giris");
  }

  const accesses = await getParentAccessibleChildren(session.user.id);
  const membership = await getParentFamilyContext(session.user.id);

  if (membership && membership.family.onboardingStep !== "COMPLETE") {
    const step = membership.family.onboardingStep;
    if (step === "CHILD_PROFILE") redirect("/veli/onboarding");
    if (step === "EXPLANATION") redirect("/veli/onboarding/aciklama");
    if (step === "PAIRING") redirect("/veli/onboarding/eslestirme");
  }

  if (accesses.length === 0) {
    redirect("/veli/onboarding");
  }

  redirect("/veli/ana");
}
