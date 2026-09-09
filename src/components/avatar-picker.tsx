"use client";

import { useActionState, useState } from "react";
import { saveChildAvatarAction, type ActionState } from "@/app/actions";
import { AVATARS } from "@/lib/constants";
import { Button } from "@/components/ui";

const initial: ActionState = {};

export function AvatarPicker({ current }: { current: string | null }) {
  const [selected, setSelected] = useState(current ?? "deniz");
  const [state, action, pending] = useActionState(saveChildAvatarAction, initial);

  return (
    <form action={action} className="space-y-5">
      <input type="hidden" name="avatarKey" value={selected} />
      <div className="grid grid-cols-3 gap-3" role="radiogroup" aria-label="Avatar seçimi">
        {AVATARS.map((avatar) => {
          const active = selected === avatar.key;
          return (
            <button
              key={avatar.key}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => setSelected(avatar.key)}
              className="flex min-h-24 flex-col items-center justify-center rounded-2xl border text-center"
              style={{
                borderColor: active ? "var(--accent)" : "var(--line)",
                background: active ? "var(--accent-soft)" : "white",
              }}
            >
              <span className="text-3xl" aria-hidden>
                {avatar.emoji}
              </span>
              <span className="mt-1 text-sm font-semibold">{avatar.label}</span>
            </button>
          );
        })}
      </div>
      {state.errors?.avatarKey ? (
        <p className="text-sm" style={{ color: "var(--danger)" }} role="alert">
          {state.errors.avatarKey}
        </p>
      ) : null}
      <Button type="submit" disabled={pending}>
        {pending ? "Kaydediliyor…" : "Devam et"}
      </Button>
    </form>
  );
}
