"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { PROMPT_OPTIONS } from "@/lib/constants";
import { Button, Panel } from "@/components/ui";

export function NewEntryPromptPicker() {
  const router = useRouter();
  const [selected, setSelected] = useState<(typeof PROMPT_OPTIONS)[number]["key"] | null>(null);
  const [error, setError] = useState<string | undefined>();
  const [pending, setPending] = useState(false);

  const selectedPrompt = PROMPT_OPTIONS.find((p) => p.key === selected);

  async function start() {
    if (!selected) {
      setError("Bir seçenek seç.");
      return;
    }
    setPending(true);
    setError(undefined);
    const clientRequestId =
      typeof crypto !== "undefined" && crypto.randomUUID
        ? crypto.randomUUID()
        : `req_${Date.now()}`;

    try {
      const res = await fetch("/api/child/journal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ promptKey: selected, clientRequestId }),
      });
      const data = (await res.json()) as { entry?: { id: string }; error?: string };
      if (!res.ok || !data.entry) {
        setError(data.error || "Oluşturulamadı.");
        setPending(false);
        return;
      }
      router.push(`/cocuk/gunluk/${data.entry.id}`);
      router.refresh();
    } catch {
      setError("Bağlantı hatası. Tekrar dene.");
      setPending(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="space-y-2" role="radiogroup" aria-label="Konu seçimi">
        {PROMPT_OPTIONS.map((prompt) => {
          const active = selected === prompt.key;
          return (
            <button
              key={prompt.key}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => setSelected(prompt.key)}
              className="flex min-h-14 w-full items-center rounded-2xl border px-4 text-left text-base font-semibold"
              style={{
                borderColor: active ? "var(--accent)" : "var(--line)",
                background: active ? "var(--accent-soft)" : "white",
              }}
            >
              {prompt.label}
            </button>
          );
        })}
      </div>

      {selectedPrompt ? (
        <Panel>
          <p className="text-base leading-relaxed">{selectedPrompt.question}</p>
        </Panel>
      ) : null}

      {error ? (
        <p className="text-sm" style={{ color: "var(--danger)" }} role="alert">
          {error}
        </p>
      ) : null}

      <Button type="button" disabled={pending || !selected} onClick={() => void start()}>
        {pending ? "Açılıyor…" : "Yazmaya başla"}
      </Button>
    </div>
  );
}
