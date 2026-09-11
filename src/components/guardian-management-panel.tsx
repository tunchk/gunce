"use client";

import { useActionState } from "react";
import {
  inviteGuardianAction,
  removeGuardianAction,
  revokeGuardianInviteAction,
  type ActionState,
} from "@/app/actions";
import { Button, TextField } from "@/components/ui";

const initial: ActionState = {};

type GuardianRow = {
  userId: string;
  name: string;
  email: string;
  role: "MANAGER" | "INVITED";
  isSelf: boolean;
};

type InviteRow = {
  id: string;
  email: string;
  expiresAt: string;
};

export function GuardianManagementPanel({
  childId,
  childName,
  canManage,
  guardians,
  pendingInvites,
}: {
  childId: string;
  childName: string;
  canManage: boolean;
  guardians: GuardianRow[];
  pendingInvites: InviteRow[];
}) {
  const [inviteState, inviteAction, invitePending] = useActionState(
    inviteGuardianAction,
    initial,
  );
  const [removeState, removeAction, removePending] = useActionState(
    removeGuardianAction,
    initial,
  );
  const [revokeState, revokeAction, revokePending] = useActionState(
    revokeGuardianInviteAction,
    initial,
  );

  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">Veliler — {childName}</h2>
        <p className="mt-2 text-sm leading-relaxed" style={{ color: "var(--muted)" }}>
          Uygulama daveti erişim verir; yasal velayet belgesi doğrulamaz. Plan ve hedefler
          aktif velilere görünür. Günlük paylaşımları çocuk alıcı seçerek onaylar.
        </p>
      </div>

      <ul className="space-y-2">
        {guardians.map((g) => (
          <li
            key={g.userId}
            className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border p-3 text-sm"
            style={{ borderColor: "var(--line)" }}
          >
            <div>
              <p className="font-semibold">
                {g.name}
                {g.isSelf ? " (sen)" : ""}
              </p>
              <p style={{ color: "var(--muted)" }}>
                {g.email} · {g.role === "MANAGER" ? "Yönetici veli" : "Davetli veli"}
              </p>
            </div>
            {canManage && !g.isSelf ? (
              <form action={removeAction}>
                <input type="hidden" name="childId" value={childId} />
                <input type="hidden" name="targetUserId" value={g.userId} />
                <Button type="submit" variant="danger" disabled={removePending}>
                  Erişimi kaldır
                </Button>
              </form>
            ) : null}
          </li>
        ))}
      </ul>

      {pendingInvites.length > 0 ? (
        <div className="space-y-2">
          <h3 className="text-sm font-semibold">Bekleyen davetler</h3>
          {pendingInvites.map((inv) => (
            <div
              key={inv.id}
              className="flex flex-wrap items-center justify-between gap-2 text-sm"
            >
              <span>
                {inv.email} · {new Date(inv.expiresAt).toLocaleString("tr-TR")}
              </span>
              {canManage ? (
                <form action={revokeAction}>
                  <input type="hidden" name="invitationId" value={inv.id} />
                  <Button type="submit" variant="ghost" disabled={revokePending}>
                    Daveti iptal et
                  </Button>
                </form>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}

      {canManage ? (
        <form action={inviteAction} className="space-y-3">
          <input type="hidden" name="childId" value={childId} />
          <TextField
            label="Veli e-postası"
            name="email"
            type="email"
            autoComplete="email"
            required
            error={inviteState.errors?.email}
          />
          <p className="text-xs" style={{ color: "var(--muted)" }}>
            Davetli veli plan/hedefleri ve kendisine yayınlanan paylaşımları görür; eşleştirme
            yönetemez ve başka veli davet edemez. Gönderen hesabın e-postası doğrulanmış
            olmalıdır.
          </p>
          <Button type="submit" disabled={invitePending}>
            {invitePending ? "Gönderiliyor…" : "Veli davet et"}
          </Button>
          {inviteState.message ? (
            <p
              className="text-sm"
              style={{ color: inviteState.ok ? "var(--ink)" : "var(--danger)" }}
              role={inviteState.ok ? "status" : "alert"}
            >
              {inviteState.message}
            </p>
          ) : null}
        </form>
      ) : (
        <p className="text-sm" style={{ color: "var(--muted)" }}>
          Davetli veliler başka veli ekleyemez veya kaldıramaz.
        </p>
      )}

      {removeState.message ? (
        <p
          className="text-sm"
          style={{ color: removeState.ok ? "var(--ink)" : "var(--danger)" }}
          role={removeState.ok ? "status" : "alert"}
        >
          {removeState.message}
        </p>
      ) : null}
      {revokeState.message ? (
        <p
          className="text-sm"
          style={{ color: revokeState.ok ? "var(--ink)" : "var(--danger)" }}
          role={revokeState.ok ? "status" : "alert"}
        >
          {revokeState.message}
        </p>
      ) : null}
    </section>
  );
}
