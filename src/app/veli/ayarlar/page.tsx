import Link from "next/link";
import { redirect } from "next/navigation";
import { signOutAction } from "@/app/actions";
import { InvitationPanel } from "@/components/invitation-panel";
import { RevokeSessionsForm } from "@/components/revoke-sessions-form";
import { Button, Panel, Shell } from "@/components/ui";
import { AGE_GROUP_LABELS, avatarEmoji } from "@/lib/constants";
import { getAppSession, getParentFamilyContext } from "@/lib/session";

export default async function ParentSettingsPage() {
  const session = await getAppSession();
  if (!session || session.user.role !== "PARENT") redirect("/giris");

  const membership = await getParentFamilyContext(session.user.id);
  if (!membership) redirect("/veli/onboarding");
  if (membership.family.onboardingStep !== "COMPLETE") redirect("/veli");

  const child = membership.family.children[0];
  if (!child) redirect("/veli/onboarding");

  const activeSessions = child.user?.sessions?.length ?? 0;
  const latestInvite = child.invitations[0];
  let pairingStatus = "Henüz eşleştirilmedi";
  if (child.userId && activeSessions > 0) {
    pairingStatus = `Aktif çocuk oturumu: ${activeSessions}`;
  } else if (child.userId) {
    pairingStatus = "Daha önce eşleştirildi; şu an aktif oturum yok";
  } else if (
    latestInvite &&
    !latestInvite.redeemedAt &&
    !latestInvite.revokedAt &&
    latestInvite.expiresAt > new Date()
  ) {
    pairingStatus = "Bekleyen davet var (kod yalnızca oluşturulurken gösterilir)";
  }

  return (
    <Shell title="Aile ayarları" subtitle="Eşleştirme ve oturum yönetimi." wide>
      <div className="space-y-4">
        <Panel>
          <h2 className="text-lg font-semibold">Çocuk profili</h2>
          <div className="mt-3 flex items-center gap-3">
            <span className="text-4xl" aria-hidden>
              {avatarEmoji(child.avatarKey)}
            </span>
            <div>
              <p className="text-xl font-semibold">{child.displayName}</p>
              <p className="text-sm" style={{ color: "var(--muted)" }}>
                {AGE_GROUP_LABELS[child.ageGroup]} · {child.timeZone}
              </p>
            </div>
          </div>
        </Panel>

        <Panel>
          <h2 className="text-lg font-semibold">Eşleştirme</h2>
          <p className="mt-2 text-sm" style={{ color: "var(--muted)" }}>
            {pairingStatus}
          </p>
          <div className="mt-4">
            <InvitationPanel childId={child.id} childName={child.displayName} />
          </div>
          <div className="mt-4">
            <RevokeSessionsForm childId={child.id} />
          </div>
        </Panel>

        <Link href="/veli/ana">
          <Button variant="secondary">Paylaşımlara dön</Button>
        </Link>

        <form action={signOutAction}>
          <Button type="submit" variant="ghost">
            Çıkış yap
          </Button>
        </form>
      </div>
    </Shell>
  );
}
