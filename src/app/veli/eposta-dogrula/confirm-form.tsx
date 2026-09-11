"use client";

import Link from "next/link";
import { useActionState } from "react";
import {
  confirmEmailVerificationAction,
  type ActionState,
} from "@/app/actions";
import { Button, Panel } from "@/components/ui";

const initial: ActionState = {};

export function ConfirmEmailForm({ token }: { token: string }) {
  const [state, action, pending] = useActionState(
    confirmEmailVerificationAction,
    initial,
  );

  if (!token) {
    return (
      <Panel>
        <p className="text-sm" style={{ color: "var(--danger)" }} role="alert">
          Doğrulama bağlantısı eksik veya geçersiz. Yeni bir doğrulama e-postası
          istemek için veli ayarlarından tekrar gönderebilirsin.
        </p>
        <p className="mt-4 text-sm">
          <Link href="/giris" className="font-semibold underline">
            Girişe dön
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
        {state.message ? (
          <p className="text-sm" style={{ color: "var(--danger)" }} role="alert">
            {state.message}
          </p>
        ) : null}
        <Button type="submit" disabled={pending}>
          {pending ? "Doğrulanıyor…" : "E-postamı doğrula"}
        </Button>
      </form>
      <p className="mt-4 text-sm" style={{ color: "var(--muted)" }}>
        Bağlantı çalışmazsa giriş yapıp{" "}
        <Link href="/veli/ayarlar" className="font-semibold underline">
          Ayarlar
        </Link>
        ’dan doğrulama e-postasını tekrar gönderebilirsin.
      </p>
    </Panel>
  );
}
