import type { Metadata } from "next";
import { ResetPasswordForm } from "./reset-form";

export const metadata: Metadata = {
  title: "Şifreni yenile — Günce",
  referrer: "no-referrer",
  robots: { index: false, follow: false },
};

type Props = {
  searchParams: Promise<{ token?: string; error?: string }>;
};

export default async function ResetPasswordPage({ searchParams }: Props) {
  const params = await searchParams;
  const token = typeof params.token === "string" ? params.token.trim() : "";
  const linkError =
    typeof params.error === "string" ? params.error.trim() : "";

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
      <h1 className="mt-4 text-2xl font-semibold">Şifreni yenile</h1>
      <p className="mt-2 text-sm leading-relaxed" style={{ color: "var(--muted)" }}>
        Yeni şifreni gir. Bağlantıyı yalnızca açmak şifreni değiştirmez.
      </p>
      <div className="mt-6">
        <ResetPasswordForm
          token={token}
          initialError={
            linkError
              ? "Bu yenileme bağlantısı geçersiz veya süresi dolmuş."
              : undefined
          }
        />
      </div>
    </main>
  );
}
