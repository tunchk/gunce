"use client";

import Link from "next/link";
import { useActionState } from "react";
import { registerParentAction, type ActionState } from "@/app/actions";
import { Button, Panel, Shell, TextField } from "@/components/ui";

const initial: ActionState = {};

export default function RegisterPage() {
  const [state, action, pending] = useActionState(registerParentAction, initial);

  return (
    <Shell title="Veli kaydı" subtitle="E-posta ve şifre ile güvenli bir veli hesabı oluştur.">
      <Panel>
        <form action={action} className="space-y-4">
          <TextField label="Adın" name="name" autoComplete="name" required error={state.errors?.name} />
          <TextField
            label="E-posta"
            name="email"
            type="email"
            autoComplete="email"
            required
            error={state.errors?.email}
          />
          <TextField
            label="Şifre"
            name="password"
            type="password"
            autoComplete="new-password"
            required
            minLength={8}
            error={state.errors?.password}
          />
          {state.message ? (
            <p className="text-sm" style={{ color: "var(--danger)" }} role="alert">
              {state.message}
            </p>
          ) : null}
          <Button type="submit" disabled={pending}>
            {pending ? "Kaydediliyor…" : "Kayıt ol"}
          </Button>
        </form>
        <p className="mt-4 text-sm" style={{ color: "var(--muted)" }}>
          Zaten hesabın var mı?{" "}
          <Link href="/giris" className="font-semibold underline">
            Giriş yap
          </Link>
        </p>
      </Panel>
    </Shell>
  );
}
