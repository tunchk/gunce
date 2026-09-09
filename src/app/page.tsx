import Link from "next/link";
import { redirect } from "next/navigation";
import { Button, Panel, Shell } from "@/components/ui";
import { getAppSession } from "@/lib/session";

export default async function HomePage() {
  const session = await getAppSession();
  if (session?.user.role === "PARENT") redirect("/veli");
  if (session?.user.role === "CHILD") redirect("/cocuk");

  return (
    <Shell
      title="Gününü anlat. Haftanı birlikte düzenleyelim."
      subtitle="Günce, çocuklar ve velileri için güvenli bir alan. Bu sürümde hesaplar, aile üyeliği ve eşleştirme hazır."
    >
      <div className="space-y-4">
        <Panel>
          <h2 className="text-lg font-semibold">Veli misin?</h2>
          <p className="mt-2 text-sm leading-relaxed" style={{ color: "var(--muted)" }}>
            Hesap oluştur, çocuğunun profilini ekle ve cihazını güvenli bir davet koduyla eşleştir.
          </p>
          <div className="mt-5 space-y-3">
            <Link href="/kayit">
              <Button>Veli olarak kayıt ol</Button>
            </Link>
            <Link href="/giris">
              <Button variant="secondary">Giriş yap</Button>
            </Link>
          </div>
        </Panel>

        <Panel>
          <h2 className="text-lg font-semibold">Çocuk musun?</h2>
          <p className="mt-2 text-sm leading-relaxed" style={{ color: "var(--muted)" }}>
            Velinin verdiği davet kodunu girerek kendi alanına gir.
          </p>
          <div className="mt-5">
            <Link href="/cocuk/giris">
              <Button variant="ghost">Davet koduyla gir</Button>
            </Link>
          </div>
        </Panel>
      </div>
    </Shell>
  );
}
