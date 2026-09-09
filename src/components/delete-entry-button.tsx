"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui";

export function DeleteEntryButton({ entryId }: { entryId: string }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [pending, setPending] = useState(false);

  async function onDelete() {
    setPending(true);
    setError(undefined);
    try {
      const res = await fetch(`/api/child/journal/${entryId}`, { method: "DELETE" });
      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        setError(data.error || "Silinemedi.");
        setPending(false);
        return;
      }
      router.replace("/cocuk/gunluk");
      router.refresh();
    } catch {
      setError("Bağlantı hatası.");
      setPending(false);
    }
  }

  if (!confirming) {
    return (
      <Button type="button" variant="ghost" onClick={() => setConfirming(true)}>
        Kaydı sil
      </Button>
    );
  }

  return (
    <div className="space-y-3 rounded-2xl border p-4" style={{ borderColor: "var(--danger)" }}>
      <p className="text-sm leading-relaxed">
        Bu yazı, paylaşım taslağı ve varsa yayımlanmış içerik kalıcı olarak silinecek. Emin misin?
      </p>
      <div className="flex flex-col gap-2 sm:flex-row">
        <Button type="button" variant="danger" disabled={pending} onClick={() => void onDelete()}>
          Evet, sil
        </Button>
        <Button type="button" variant="ghost" disabled={pending} onClick={() => setConfirming(false)}>
          Vazgeç
        </Button>
      </div>
      {error ? (
        <p className="text-sm" style={{ color: "var(--danger)" }} role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
