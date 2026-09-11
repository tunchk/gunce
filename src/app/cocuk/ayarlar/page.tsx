import Link from "next/link";
import { redirect } from "next/navigation";
import { signOutAction } from "@/app/actions";
import { Button, Panel, Shell } from "@/components/ui";
import { getAppSession, getChildProfileForUser } from "@/lib/session";

export default async function ChildSettingsPage() {
  const session = await getAppSession();
  if (!session || session.user.role !== "CHILD") redirect("/cocuk/giris");
  const child = await getChildProfileForUser(session.user.id);
  if (!child || child.onboardingStep !== "COMPLETE") redirect("/cocuk");

  return (
    <Shell
      title="Ayarlar"
      subtitle="Hatırlatmalar ve oturum. Ana akışı sade tutmak için buradalar."
      withChildNav
    >
      <div className="space-y-4">
        <Panel>
          <h2 className="text-lg font-semibold">Hatırlatmalar</h2>
          <p className="mt-2 text-sm leading-relaxed" style={{ color: "var(--muted)" }}>
            Günlük davet ve çalışma adımı hatırlatmaları isteğe bağlıdır; varsayılan kapalıdır.
          </p>
          <Link href="/cocuk/hatirlatmalar" className="mt-4 block">
            <Button variant="secondary">Hatırlatmaları aç</Button>
          </Link>
        </Panel>

        <Panel>
          <h2 className="text-lg font-semibold">Oturum</h2>
          <p className="mt-2 text-sm leading-relaxed" style={{ color: "var(--muted)" }}>
            Bu cihazdaki çocuk oturumunu kapatır.
          </p>
          <form action={signOutAction} className="mt-4">
            <Button type="submit" variant="ghost">
              Çıkış yap
            </Button>
          </form>
        </Panel>

        <Link
          href="/cocuk/ana"
          className="inline-flex min-h-12 items-center text-sm font-semibold underline"
        >
          Ana sayfaya dön
        </Link>
      </div>
    </Shell>
  );
}
