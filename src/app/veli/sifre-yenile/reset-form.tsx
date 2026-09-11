"use client";

import Link from "next/link";
import { useActionState } from "react";
import { resetPasswordAction, type ActionState } from "@/app/actions";
import { Button, Panel, TextField } from "@/components/ui";

const initial: ActionState = {};

export function ResetPasswordForm({
  token,
  initialError,
}: {
  token: string;
  initialError?: string;
}) {
  const [state, action, pending] = useActionState(resetPasswordAction, initial);

  if (!token) {
    return (
      <Panel>
        <p className="text-sm" style={{ color: "var(--danger)" }} role="alert">
          {initialError ||
            "Yenileme bağlantısı eksik veya geçersiz. Yeni bir bağlantı iste."}
        </p>
        <p className="mt-4 text-sm">
          <Link href="/veli/sifremi-unuttum" className="font-semibold underline">
            Şifremi unuttum
          </Link>
        </p>
      </Panel>
    );
  }

  if (state.ok) {
    return (
      <Panel>
        <p className="text-sm" role="status">
          {state.message}
        </p>
        <p className="mt-4 text-sm">
          <Link href="/giris" className="font-semibold underline">
            Giriş yap
          </Link>
        </p>
      </Panel>
    );
  }

  return (
    <Panel>
      <form action={action} className="space-y-4">
        <input type="hidden" name="token" value={token} />
        <TextField
          label="Yeni şifre"
          name="password"
          type="password"
          autoComplete="new-password"
          required
          error={state.errors?.password}
        />
        <TextField
          label="Yeni şifre tekrar"
          name="passwordConfirm"
          type="password"
          autoComplete="new-password"
          required
          error={state.errors?.passwordConfirm}
        />
        {state.message || initialError ? (
          <p className="text-sm" style={{ color: "var(--danger)" }} role="alert">
            {state.message || initialError}
          </p>
        ) : null}
        <Button type="submit" disabled={pending}>
          {pending ? "Kaydediliyor…" : "Şifreyi güncelle"}
        </Button>
      </form>
      <p className="mt-4 text-sm" style={{ color: "var(--muted)" }}>
        <Link href="/giris" className="font-semibold underline">
          Girişe dön
        </Link>
      </p>
    </Panel>
  );
}
