"use client";

import Link from "next/link";
import { useActionState } from "react";
import { acceptGuardianInviteAction, type ActionState } from "@/app/actions";
import { Button, Panel } from "@/components/ui";

const initial: ActionState = {};

export function AcceptInviteForm({ token }: { token: string }) {
  const [state, action, pending] = useActionState(
    acceptGuardianInviteAction,
    initial,
  );

  if (state.ok) {
    return (
      <Panel>
        <p className="text-sm" role="status">
          {state.message}
        </p>
        <p className="mt-4 text-sm">
          <Link href="/veli/ana" className="font-semibold underline">
            Ana sayfaya git
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
          {pending ? "Kabul ediliyor…" : "Daveti kabul et"}
        </Button>
      </form>
    </Panel>
  );
}
