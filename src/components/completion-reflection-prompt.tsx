"use client";

import { useState } from "react";
import { Button, FieldError } from "@/components/ui";
import type { StudyStepView } from "@/lib/plan";

/**
 * Optional post-completion self-report. Completion already succeeded;
 * skip / save failure must not undo DONE.
 */
export function CompletionReflectionPrompt({
  step,
  onUpdated,
  onDismiss,
}: {
  step: StudyStepView;
  onUpdated?: (next: StudyStepView) => void;
  onDismiss: () => void;
}) {
  const [text, setText] = useState(step.completionReflection || "");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();

  async function save() {
    setPending(true);
    setError(undefined);
    try {
      const res = await fetch(`/api/child/plan/step/${step.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          op: "set_reflection",
          expectedRevision: step.revision,
          reflection: text,
        }),
      });
      const data = (await res.json()) as {
        error?: string;
        studyStep?: StudyStepView;
      };
      if (!res.ok || !data.studyStep) {
        setError(data.error || "Not kaydedilemedi. Tamamlama yine de geçerli.");
        setPending(false);
        return;
      }
      onUpdated?.(data.studyStep);
      onDismiss();
    } catch {
      setError("Bağlantı hatası. Tamamlama yine de geçerli.");
      setPending(false);
    }
  }

  return (
    <div
      className="mt-3 space-y-3 rounded-2xl border p-3"
      style={{ borderColor: "var(--line)", background: "var(--accent-soft)" }}
      role="region"
      aria-label="Tamamlama notu"
    >
      <p className="text-sm font-semibold">Neler yaptın?</p>
      <p className="text-xs leading-relaxed" style={{ color: "var(--muted)" }}>
        İsteğe bağlı. Velilerin bu notu görebilir. Kanıt veya puan değildir.
      </p>
      <label className="sr-only" htmlFor={`reflection-${step.id}`}>
        Tamamlama notu
      </label>
      <textarea
        id={`reflection-${step.id}`}
        className="min-h-24 w-full rounded-2xl border px-3 py-2 text-sm"
        style={{ borderColor: "var(--line)", background: "white" }}
        placeholder="10 soru çözdüm, iki soruda zorlandım."
        value={text}
        maxLength={1000}
        onChange={(e) => setText(e.target.value)}
      />
      <div className="flex flex-col gap-2">
        <Button type="button" disabled={pending} onClick={() => void save()}>
          Kaydet
        </Button>
        <Button
          type="button"
          variant="ghost"
          disabled={pending}
          onClick={onDismiss}
        >
          Şimdi geç
        </Button>
      </div>
      <FieldError message={error} />
    </div>
  );
}
