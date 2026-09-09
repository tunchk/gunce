"use client";

import Link from "next/link";
import { useActionState } from "react";
import { signInParentAction, type ActionState } from "@/app/actions";
import { Button, Panel, Shell, TextField } from "@/components/ui";

const initial: ActionState = {};

export default function SignInPage() {
  const [state, action, pending] = useActionState(signInParentAction, initial);

  return (
    <Shell title="Veli girişi" subtitle="Hesabına giriş yaparak aile alanına dön.">
      <Panel>
        <form action={action} className="space-y-4">
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
            autoComplete="current-password"
            required
            error={state.errors?.password}
          />
          {state.message ? (
            <p className="text-sm" style={{ color: "var(--danger)" }} role="alert">
              {state.message}
            </p>
          ) : null}
          <Button type="submit" disabled={pending}>
            {pending ? "Giriş yapılıyor…" : "Giriş yap"}
          </Button>
        </form>
        <p className="mt-4 text-sm" style={{ color: "var(--muted)" }}>
          Hesabın yok mu?{" "}
          <Link href="/kayit" className="font-semibold underline">
            Kayıt ol
          </Link>
        </p>
      </Panel>
    </Shell>
  );
}
