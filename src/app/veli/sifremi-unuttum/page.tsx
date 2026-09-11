"use client";

import Link from "next/link";
import { useActionState } from "react";
import { requestPasswordResetAction, type ActionState } from "@/app/actions";
import { Button, Panel, Shell, TextField } from "@/components/ui";

const initial: ActionState = {};

export default function ForgotPasswordPage() {
  const [state, action, pending] = useActionState(
    requestPasswordResetAction,
    initial,
  );

  return (
    <Shell
      title="Şifremi unuttum"
      subtitle="E-posta adresini yaz; hesap varsa yenileme bağlantısı gönderilir."
    >
      <Panel>
        {state.ok ? (
          <p className="text-sm leading-relaxed" role="status">
            {state.message}
          </p>
        ) : (
          <form action={action} className="space-y-4">
            <TextField
              label="E-posta"
              name="email"
              type="email"
              autoComplete="email"
              required
              error={state.errors?.email}
            />
            {state.message ? (
              <p
                className="text-sm"
                style={{ color: "var(--danger)" }}
                role="alert"
              >
                {state.message}
              </p>
            ) : null}
            <Button type="submit" disabled={pending}>
              {pending ? "Gönderiliyor…" : "Yenileme bağlantısı gönder"}
            </Button>
          </form>
        )}
        <p className="mt-4 text-sm" style={{ color: "var(--muted)" }}>
          <Link href="/giris" className="font-semibold underline">
            Girişe dön
          </Link>
        </p>
      </Panel>
    </Shell>
  );
}
