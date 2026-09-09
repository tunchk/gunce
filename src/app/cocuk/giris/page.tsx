"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button, Panel, Shell, TextField } from "@/components/ui";

export default function ChildSignInPage() {
  const router = useRouter();
  const [token, setToken] = useState("");
  const [error, setError] = useState<string | undefined>();
  const [pending, setPending] = useState(false);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(undefined);

    try {
      const response = await fetch("/api/pairing/redeem", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: token.trim() }),
      });
      const data = (await response.json()) as { error?: string };
      if (!response.ok) {
        setError(data.error || "Eşleştirme başarısız.");
        setPending(false);
        return;
      }
      router.replace("/cocuk/onboarding");
      router.refresh();
    } catch {
      setError("Bağlantı hatası. Tekrar dene.");
      setPending(false);
    }
  }

  return (
    <Shell
      title="Davet koduyla gir"
      subtitle="Velinin telefonunda veya kâğıtta gördüğün kodu yaz. Bu işlem bu cihazdaki veli oturumunu kapatır."
    >
      <Panel>
        <form onSubmit={onSubmit} className="space-y-4">
          <TextField
            label="Davet kodu"
            name="token"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            autoComplete="one-time-code"
            required
            error={error}
          />
          <Button type="submit" disabled={pending || token.trim().length < 20}>
            {pending ? "Bağlanıyor…" : "Çocuk alanına gir"}
          </Button>
        </form>
      </Panel>
    </Shell>
  );
}
