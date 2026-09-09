"use client";

import Link from "next/link";
import { useActionState } from "react";
import { createInvitationAction, type ActionState } from "@/app/actions";
import { Button } from "@/components/ui";

const initial: ActionState = {};

export function InvitationPanel({
  childId,
  childName,
  showContinue = false,
}: {
  childId: string;
  childName: string;
  showContinue?: boolean;
}) {
  const [state, action, pending] = useActionState(createInvitationAction, initial);

  return (
    <div className="space-y-4">
      <p className="text-sm leading-relaxed" style={{ color: "var(--muted)" }}>
        <strong style={{ color: "var(--ink)" }}>{childName}</strong> için yeni bir davet kodu
        oluştur. Önceki kullanılmamış kodlar iptal edilir. Kodun kendisi yalnızca bir kez gösterilir.
      </p>
      <form action={action}>
        <input type="hidden" name="childId" value={childId} />
        <Button type="submit" disabled={pending}>
          {pending ? "Oluşturuluyor…" : "Davet kodu oluştur"}
        </Button>
      </form>
      {state.message && !state.ok ? (
        <p className="text-sm" style={{ color: "var(--danger)" }} role="alert">
          {state.message}
        </p>
      ) : null}
      {state.token ? (
        <div
          className="rounded-2xl p-4"
          style={{ background: "var(--accent-soft)", border: "1px solid var(--line)" }}
        >
          <p className="text-sm font-semibold">Davet kodu (bir kez gösterilir)</p>
          <p className="mt-2 break-all font-mono text-lg" aria-live="polite">
            {state.token}
          </p>
          <p className="mt-2 text-sm" style={{ color: "var(--muted)" }}>
            Çocuğun cihazında <strong>/cocuk/giris</strong> sayfasına bu kodu yazdır.
          </p>
        </div>
      ) : null}
      {showContinue ? (
        <Link href="/veli/ana" className="inline-flex min-h-12 w-full items-center justify-center rounded-2xl px-4 text-base font-semibold" style={{ border: "1px solid var(--line)" }}>
          Veli ana ekranına git
        </Link>
      ) : null}
    </div>
  );
}
