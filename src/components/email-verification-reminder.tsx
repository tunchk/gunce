"use client";

import { useActionState } from "react";
import {
  resendVerificationEmailAction,
  type ActionState,
} from "@/app/actions";
import { Button } from "@/components/ui";

const initial: ActionState = {};

export function EmailVerificationReminder({ email }: { email: string }) {
  const [state, action, pending] = useActionState(
    resendVerificationEmailAction,
    initial,
  );

  return (
    <section
      className="rounded-2xl p-4 sm:p-5"
      style={{
        background: "color-mix(in srgb, var(--accent) 12%, var(--surface))",
        border: "1px solid var(--line)",
      }}
      aria-label="E-posta doğrulama hatırlatması"
    >
      <h2 className="text-base font-semibold">E-postanı doğrula</h2>
      <p className="mt-2 text-sm leading-relaxed" style={{ color: "var(--muted)" }}>
        <span className="font-medium" style={{ color: "var(--ink)" }}>
          {email}
        </span>{" "}
        henüz doğrulanmadı. Uygulamayı kullanmaya devam edebilirsin; doğrulama
        isteğe bağlıdır.
      </p>
      <form action={action} className="mt-3">
        <Button type="submit" variant="secondary" disabled={pending}>
          {pending
            ? "Gönderiliyor…"
            : "Doğrulama e-postasını tekrar gönder"}
        </Button>
      </form>
      {state.message ? (
        <p
          className="mt-2 text-sm"
          style={{ color: state.ok ? "var(--ink)" : "var(--danger)" }}
          role={state.ok ? "status" : "alert"}
        >
          {state.message}
        </p>
      ) : null}
    </section>
  );
}
