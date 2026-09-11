import type { Metadata } from "next";
import Link from "next/link";
import { AcceptInviteForm } from "./accept-form";
import { peekGuardianInvitation } from "@/lib/guardian";
import { getAppSession } from "@/lib/session";

export const metadata: Metadata = {
  title: "Veli daveti — Günce",
  referrer: "no-referrer",
  robots: { index: false, follow: false },
};

type Props = {
  searchParams: Promise<{ token?: string }>;
};

export default async function GuardianInvitePage({ searchParams }: Props) {
  const params = await searchParams;
  const token = typeof params.token === "string" ? params.token.trim() : "";
  const session = await getAppSession();
  const peek = token ? await peekGuardianInvitation(token) : { status: "invalid" as const };

  return (
    <main className="mx-auto w-full px-4 py-10" style={{ maxWidth: 480 }}>
      <p
        className="text-3xl font-semibold tracking-tight"
        style={{ fontFamily: "var(--font-display-loaded), var(--font-display)" }}
      >
        Günce
      </p>
      <h1 className="mt-4 text-2xl font-semibold">Veli daveti</h1>
      <p className="mt-2 text-sm leading-relaxed" style={{ color: "var(--muted)" }}>
        Bu davet uygulama erişimi verir; yasal velayet belgesi doğrulamaz. Bağlantıyı yalnızca
        açmak erişim vermez — hesabınla giriş yapıp açıkça kabul etmelisin.
      </p>

      <div className="mt-6 space-y-4">
        {!token || peek.status === "invalid" ? (
          <p className="text-sm" style={{ color: "var(--danger)" }} role="alert">
            Davet bağlantısı geçersiz.
          </p>
        ) : peek.status === "expired" ? (
          <p className="text-sm" style={{ color: "var(--danger)" }} role="alert">
            Davetin süresi dolmuş. Yeni bir davet iste.
          </p>
        ) : peek.status === "revoked" ? (
          <p className="text-sm" style={{ color: "var(--danger)" }} role="alert">
            Bu davet iptal edilmiş.
          </p>
        ) : peek.status === "redeemed" ? (
          <p className="text-sm" role="status">
            Bu davet zaten kullanılmış.
          </p>
        ) : (
          <>
            <p className="text-sm">
              <span className="font-semibold">{peek.invite.invitedBy.name}</span> seni{" "}
              <span className="font-semibold">{peek.invite.child.displayName}</span> için
              davet etti (e-posta: {peek.invite.email}).
            </p>
            {!session || session.user.role !== "PARENT" ? (
              <p className="text-sm" style={{ color: "var(--muted)" }}>
                Kabul etmek için{" "}
                <Link href="/giris" className="font-semibold underline">
                  giriş yap
                </Link>{" "}
                veya{" "}
                <Link href="/kayit" className="font-semibold underline">
                  kayıt ol
                </Link>
                . E-posta adresin davetle aynı olmalı ve doğrulanmış olmalı.
              </p>
            ) : (
              <AcceptInviteForm token={token} />
            )}
          </>
        )}
      </div>
    </main>
  );
}
