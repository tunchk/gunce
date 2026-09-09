import { redirect } from "next/navigation";
import { InvitationPanel } from "@/components/invitation-panel";
import { Panel, Shell } from "@/components/ui";
import { getAppSession, getParentFamilyContext } from "@/lib/session";

export default async function ParentPairingOnboardingPage() {
  const session = await getAppSession();
  if (!session || session.user.role !== "PARENT") redirect("/giris");

  const membership = await getParentFamilyContext(session.user.id);
  const child = membership?.family.children[0];
  if (!child) redirect("/veli/onboarding");

  return (
    <Shell
      title="Çocuğun cihazını eşleştir"
      subtitle="Tek kullanımlık bir davet kodu oluştur. Kod yaklaşık 30 dakika geçerlidir."
    >
      <Panel>
        <InvitationPanel childId={child.id} childName={child.displayName} showContinue />
      </Panel>
    </Shell>
  );
}
