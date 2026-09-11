import Link from "next/link";
import { redirect } from "next/navigation";
import { signOutAction } from "@/app/actions";
import { ChildSelector } from "@/components/child-selector";
import { EmailVerificationReminder } from "@/components/email-verification-reminder";
import { GuardianManagementPanel } from "@/components/guardian-management-panel";
import { InvitationPanel } from "@/components/invitation-panel";
import { RevokeSessionsForm } from "@/components/revoke-sessions-form";
import { Button, Panel, Shell } from "@/components/ui";
import { AGE_GROUP_LABELS, avatarEmoji } from "@/lib/constants";
import {
  listChildGuardians,
  listPendingGuardianInvitations,
} from "@/lib/guardian";
import { resolveParentChildContext } from "@/lib/parent-child-context";
import { getAppSession } from "@/lib/session";

export default async function ParentSettingsPage() {
  const session = await getAppSession();
  if (!session || session.user.role !== "PARENT") redirect("/giris");

  const ctx = await resolveParentChildContext(session.user.id);
  if (!ctx.child || !ctx.access) {
    redirect("/veli/onboarding");
  }
  if (ctx.needsOnboarding) redirect("/veli");

  const child = ctx.child;
  const canManage = ctx.access.role === "MANAGER";

  const [guardians, pending] = await Promise.all([
    listChildGuardians(child.id),
    listPendingGuardianInvitations(child.id),
  ]);

  const activeSessions =
    (
      await import("@/lib/prisma").then((m) =>
        child.userId
          ? m.prisma.session.count({
              where: { userId: child.userId, expiresAt: { gt: new Date() } },
            })
          : Promise.resolve(0),
      )
    );

  return (
    <Shell title="Aile ayarları" subtitle="Eşleştirme, veliler ve oturum yönetimi." wide>
      <div className="space-y-4">
        {!session.user.emailVerified ? (
          <EmailVerificationReminder email={session.user.email} />
        ) : null}

        <Panel>
          <ChildSelector
            childrenOptions={ctx.accesses.map((a) => ({
              id: a.child.id,
              displayName: a.child.displayName,
            }))}
            selectedId={child.id}
          />
        </Panel>

        <Panel>
          <h2 className="text-lg font-semibold">Hesap</h2>
          <p className="mt-2 text-sm" style={{ color: "var(--muted)" }}>
            {session.user.email}
            {session.user.emailVerified ? " · doğrulanmış" : " · doğrulanmamış"}
          </p>
        </Panel>

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
          <GuardianManagementPanel
            childId={child.id}
            childName={child.displayName}
            canManage={canManage}
            guardians={guardians.map((g) => ({
              userId: g.userId,
              name: g.user.name,
              email: g.user.email,
              role: g.role,
              isSelf: g.userId === session.user.id,
            }))}
            pendingInvites={pending.map((p) => ({
              id: p.id,
              email: p.email,
              expiresAt: p.expiresAt.toISOString(),
            }))}
          />
        </Panel>

        {canManage ? (
          <Panel>
            <h2 className="text-lg font-semibold">Eşleştirme</h2>
            <p className="mt-2 text-sm" style={{ color: "var(--muted)" }}>
              {child.userId
                ? activeSessions > 0
                  ? `Aktif çocuk oturumu: ${activeSessions}`
                  : "Daha önce eşleştirildi; şu an aktif oturum yok"
                : "Henüz eşleştirilmedi"}
            </p>
            <div className="mt-4">
              <InvitationPanel childId={child.id} childName={child.displayName} />
            </div>
            <div className="mt-4">
              <RevokeSessionsForm childId={child.id} />
            </div>
          </Panel>
        ) : (
          <Panel>
            <h2 className="text-lg font-semibold">Eşleştirme</h2>
            <p className="mt-2 text-sm" style={{ color: "var(--muted)" }}>
              Eşleştirmeyi yalnızca yönetici veli yönetebilir.
            </p>
          </Panel>
        )}

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
