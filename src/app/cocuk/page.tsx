import { redirect } from "next/navigation";
import { getAppSession, getChildProfileForUser } from "@/lib/session";

export default async function ChildIndexPage() {
  const session = await getAppSession();
  if (!session || session.user.role !== "CHILD") {
    redirect("/cocuk/giris");
  }

  const child = await getChildProfileForUser(session.user.id);
  if (!child) redirect("/cocuk/giris");

  if (child.onboardingStep === "AVATAR") redirect("/cocuk/onboarding");
  if (child.onboardingStep === "EXPLANATION") redirect("/cocuk/onboarding/aciklama");

  redirect("/cocuk/ana");
}
