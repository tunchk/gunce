"use client";

import { useActionState } from "react";
import { revokeChildSessionsAction, type ActionState } from "@/app/actions";
import { Button } from "@/components/ui";

const initial: ActionState = {};

export function RevokeSessionsForm({ childId }: { childId: string }) {
  const [state, action, pending] = useActionState(revokeChildSessionsAction, initial);

  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="childId" value={childId} />
      <Button type="submit" variant="danger" disabled={pending}>
        {pending ? "Sonlandırılıyor…" : "Eşleşmiş oturumları iptal et"}
      </Button>
      {state.message ? (
        <p
          className="text-sm"
          style={{ color: state.ok ? "var(--accent)" : "var(--danger)" }}
          role="status"
        >
          {state.message}
        </p>
      ) : null}
    </form>
  );
}
