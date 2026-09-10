import Link from "next/link";
import { redirect } from "next/navigation";
import { signOutAction } from "@/app/actions";
import { ParentSharedSections } from "@/components/parent-shared-sections";
import { Button, Panel, Shell } from "@/components/ui";
import { avatarEmoji } from "@/lib/constants";
import { listParentSharedContent } from "@/lib/journal";
import { getAppSession, getParentFamilyContext } from "@/lib/session";

export default async function ParentHomePage() {
  const session = await getAppSession();
  if (!session || session.user.role !== "PARENT") redirect("/giris");

  const membership = await getParentFamilyContext(session.user.id);
  if (!membership) redirect("/veli/onboarding");
  if (membership.family.onboardingStep !== "COMPLETE") redirect("/veli");

  const child = membership.family.children[0];
  if (!child) redirect("/veli/onboarding");

  const shared = await listParentSharedContent(session.user.id);

  return (
    <Shell
      title={`Merhaba, ${session.user.name}`}
      subtitle="Yalnızca çocuğunun seninle paylaştığı içerikler burada görünür."
      wide
    >
      <div className="space-y-4">
        <Panel>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <span className="text-3xl" aria-hidden>
                {avatarEmoji(child.avatarKey)}
              </span>
              <div>
                <p className="font-semibold">{child.displayName}</p>
                <p className="text-sm" style={{ color: "var(--muted)" }}>
                  Paylaşımlarını buradan takip edebilirsin.
                </p>
              </div>
            </div>
            <Link
              href="/veli/ayarlar"
              className="inline-flex min-h-11 items-center justify-center rounded-2xl px-4 text-sm font-semibold"
              style={{ border: "1px solid var(--line)" }}
            >
              Aile ayarları
            </Link>
          </div>
        </Panel>

        <ParentSharedSections
          messages={shared.messages}
          supportRequests={shared.supportRequests}
        />

        <form action={signOutAction}>
          <Button type="submit" variant="ghost">
            Çıkış yap
          </Button>
        </form>
      </div>
    </Shell>
  );
}
