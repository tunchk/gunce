import Link from "next/link";
import { redirect } from "next/navigation";
import { signOutAction } from "@/app/actions";
import { Button, Panel, Shell, SoonBadge } from "@/components/ui";
import { avatarEmoji } from "@/lib/constants";
import { getAppSession, getChildProfileForUser } from "@/lib/session";

export default async function ChildHomePage() {
  const session = await getAppSession();
  if (!session || session.user.role !== "CHILD") redirect("/cocuk/giris");

  const child = await getChildProfileForUser(session.user.id);
  if (!child) redirect("/cocuk/giris");
  if (child.onboardingStep !== "COMPLETE") redirect("/cocuk");

  return (
    <Shell title={`${avatarEmoji(child.avatarKey)} ${child.displayName}`} subtitle="Bugün nasılsın?">
      <div className="space-y-4">
        <Panel>
          <h2 className="text-xl font-semibold">Günümü anlat</h2>
          <p className="mt-2 text-sm leading-relaxed" style={{ color: "var(--muted)" }}>
            Bugününü yaz, düzenle ve istersen velinle seçtiğin kısmı paylaş.
          </p>
          <Link href="/cocuk/gunluk/yeni" className="mt-4 block">
            <Button>Günümü anlat</Button>
          </Link>
          <Link
            href="/cocuk/gunluk"
            className="mt-3 inline-flex min-h-12 items-center text-sm font-semibold underline"
          >
            Önceki yazılarım
          </Link>
        </Panel>

        <Panel>
          <h2 className="text-lg font-semibold">
            Sıradaki adımım
            <SoonBadge />
          </h2>
          <p className="mt-2 text-sm leading-relaxed" style={{ color: "var(--muted)" }}>
            Henüz bir plan adımı yok. Plan özelliği sonraki adımda gelecek.
          </p>
        </Panel>

        <p className="inline-flex min-h-12 items-center text-base font-semibold opacity-70">
          Haftama bak <SoonBadge />
        </p>
        <p className="text-sm" style={{ color: "var(--muted)" }}>
          Haftalık görünüm henüz yok. Bu metin şimdilik bilgilendirme amaçlıdır.
        </p>

        <form action={signOutAction}>
          <Button type="submit" variant="ghost">
            Çıkış yap
          </Button>
        </form>
      </div>
    </Shell>
  );
}
