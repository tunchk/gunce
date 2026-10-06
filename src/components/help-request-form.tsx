"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button, FieldError } from "@/components/ui";
import { HELP_TYPES, helpTypeLabel } from "@/lib/help-labels";
import type { HelpType } from "@prisma/client";

export function HelpRequestForm({
  studyStepId,
  commitmentId,
  planTitle,
}: {
  studyStepId?: string;
  commitmentId?: string;
  planTitle: string;
}) {
  const router = useRouter();
  const [helpType, setHelpType] = useState<HelpType | "">("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string>();
  const [pending, setPending] = useState(false);
  const [done, setDone] = useState(false);

  async function submit() {
    if (!helpType) {
      setError("Nasıl bir yardım istediğini seç.");
      return;
    }
    setPending(true);
    setError(undefined);
    try {
      const res = await fetch("/api/child/help", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          studyStepId,
          commitmentId,
          helpType,
          note,
        }),
      });
      const data = (await res.json()) as { error?: string; request?: { id: string } };
      if (!res.ok || !data.request) {
        setError(data.error || "Gönderilemedi.");
        setPending(false);
        return;
      }
      setDone(true);
      setPending(false);
      router.refresh();
      router.push(`/cocuk/yardim/${data.request.id}`);
    } catch {
      setError("Bağlantı hatası.");
      setPending(false);
    }
  }

  if (done) {
    return (
      <p className="text-sm leading-relaxed" role="status">
        Yardım isteğin gönderildi.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">Nasıl bir yardım?</h2>
        <p className="mt-1 text-sm" style={{ color: "var(--muted)" }}>
          {planTitle}
        </p>
      </div>

      <fieldset className="space-y-2">
        <legend className="sr-only">Yardım türü</legend>
        {HELP_TYPES.map((type) => (
          <label
            key={type}
            className="flex min-h-12 cursor-pointer items-center gap-3 rounded-2xl border px-4"
            style={{
              borderColor: helpType === type ? "var(--accent)" : "var(--line)",
              background: helpType === type ? "var(--accent-soft)" : "transparent",
            }}
          >
            <input
              type="radio"
              name="helpType"
              value={type}
              checked={helpType === type}
              onChange={() => setHelpType(type)}
              className="h-5 w-5"
            />
            <span className="text-sm font-semibold">{helpTypeLabel(type)}</span>
          </label>
        ))}
      </fieldset>

      <label className="block space-y-2">
        <span className="text-sm font-semibold">Not eklemek ister misin?</span>
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          maxLength={280}
          rows={3}
          placeholder="İsteğe bağlı kısa not"
          className="w-full rounded-2xl border p-3 text-base"
          style={{ borderColor: "var(--line)" }}
        />
      </label>

      {error ? <FieldError message={error} /> : null}

      <Button type="button" disabled={pending} onClick={() => void submit()}>
        {pending ? "Gönderiliyor…" : "Yardım iste"}
      </Button>
    </div>
  );
}
