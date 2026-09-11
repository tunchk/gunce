import type { Metadata } from "next";
import { ConfirmEmailForm } from "./confirm-form";

export const metadata: Metadata = {
  title: "E-postanı doğrula — Günce",
  referrer: "no-referrer",
  robots: { index: false, follow: false },
};

type Props = {
  searchParams: Promise<{ token?: string; error?: string }>;
};

export default async function VerifyEmailPage({ searchParams }: Props) {
  const params = await searchParams;
  const token = typeof params.token === "string" ? params.token.trim() : "";

  return (
    <main
      className="mx-auto w-full px-4 py-10"
      style={{ maxWidth: 480 }}
    >
      <p
        className="text-3xl font-semibold tracking-tight"
        style={{ fontFamily: "var(--font-display-loaded), var(--font-display)" }}
      >
        Günce
      </p>
      <h1 className="mt-4 text-2xl font-semibold">E-postanı doğrula</h1>
      <p className="mt-2 text-sm leading-relaxed" style={{ color: "var(--muted)" }}>
        Güvenlik için doğrulama yalnızca aşağıdaki düğmeye bastığında tamamlanır.
        Bağlantıyı yalnızca açmak hesabını değiştirmez.
      </p>
      <div className="mt-6">
        <ConfirmEmailForm token={token} />
      </div>
    </main>
  );
}
