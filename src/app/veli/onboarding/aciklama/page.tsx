import { redirect } from "next/navigation";
import { continueExplanationAction } from "@/app/actions";
import { Button, Panel, Shell } from "@/components/ui";
import { getAppSession, getParentFamilyContext } from "@/lib/session";

export default async function ParentExplanationPage() {
  const session = await getAppSession();
  if (!session || session.user.role !== "PARENT") redirect("/giris");

  const membership = await getParentFamilyContext(session.user.id);
  if (!membership?.family.children[0]) redirect("/veli/onboarding");
  if (membership.family.onboardingStep === "CHILD_PROFILE") {
    redirect("/veli/onboarding");
  }
  if (membership.family.onboardingStep === "COMPLETE") {
    redirect("/veli/ana");
  }

  return (
    <Shell title="Nasıl çalışır?" subtitle="Kısa bir özet; ayrıntılı ayarlar daha sonra gelecek.">
      <Panel>
        <ul className="space-y-3 text-base leading-relaxed" style={{ color: "var(--muted)" }}>
          <li>
            <strong style={{ color: "var(--ink)" }}>Çocuk alanı:</strong> Çocuğun kendi oturumu vardır.
            Velinin hesabına geçiş düğmesi yoktur.
          </li>
          <li>
            <strong style={{ color: "var(--ink)" }}>Paylaşım:</strong> Günlükten paylaşılacakları çocuk
            seçer. Plana eklenen işleri veli görebilir.
          </li>
          <li>
            <strong style={{ color: "var(--ink)" }}>Ortak cihaz:</strong> Çocuk alanına girmek veli
            oturumunu kapatır. Veli alanına dönmek için yeniden giriş gerekir.
          </li>
        </ul>
        <form action={continueExplanationAction} className="mt-6">
          <Button type="submit">Anladım, eşleştirmeye geç</Button>
        </form>
      </Panel>
    </Shell>
  );
}
