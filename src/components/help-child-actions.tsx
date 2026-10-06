"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button, FieldError } from "@/components/ui";
import type { HelpOfferView, HelpRequestView } from "@/lib/help-types";
import { formatDayLabelTr } from "@/lib/plan-dates";

export function HelpRequestStatusChip({ statusLabel }: { statusLabel: string }) {
  return (
    <span
      className="inline-flex min-h-8 items-center rounded-full px-3 text-xs font-semibold"
      style={{ background: "var(--accent-soft)", color: "var(--ink)" }}
    >
      {statusLabel}
    </span>
  );
}

export function ChildHelpRequestActions({
  request,
}: {
  request: HelpRequestView;
}) {
  const router = useRouter();
  const [error, setError] = useState<string>();
  const [pending, setPending] = useState(false);

  async function run(op: "cancel" | "complete" | "accept_offer", offerId?: string) {
    setPending(true);
    setError(undefined);
    try {
      const res = await fetch(`/api/child/help/${request.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ op, offerId }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) {
        setError(data.error || "İşlem başarısız.");
        setPending(false);
        return;
      }
      setPending(false);
      router.refresh();
    } catch {
      setError("Bağlantı hatası.");
      setPending(false);
    }
  }

  const pendingOffers =
    request.status === "OPEN" || request.status === "OFFERED"
      ? request.offers.filter((o) => o.status === "PENDING")
      : [];
  const waitingForHelp =
    (request.status === "OPEN" || request.status === "OFFERED") &&
    pendingOffers.length === 0;

  return (
    <div className="space-y-4">
      {waitingForHelp ? (
        <p className="text-sm leading-relaxed" style={{ color: "var(--muted)" }}>
          Yardım bekleniyor. Velilerin teklifleri burada görünecek.
        </p>
      ) : null}

      {pendingOffers.length > 0 ? (
        <div className="space-y-3">
          <h3 className="font-semibold">Gelen teklifler</h3>
          {pendingOffers.map((offer) => (
            <OfferCard
              key={offer.id}
              offer={offer}
              disabled={pending}
              onAccept={() => void run("accept_offer", offer.id)}
            />
          ))}
        </div>
      ) : null}

      {request.status === "ACCEPTED" ? (
        <Button
          type="button"
          variant="secondary"
          disabled={pending}
          onClick={() => void run("complete")}
        >
          Yardımı tamamladık
        </Button>
      ) : null}

      {request.status === "OPEN" ||
      request.status === "OFFERED" ||
      request.status === "ACCEPTED" ? (
        <Button
          type="button"
          variant="ghost"
          disabled={pending}
          onClick={() => void run("cancel")}
        >
          İsteği iptal et
        </Button>
      ) : null}

      {error ? <FieldError message={error} /> : null}
    </div>
  );
}

function OfferCard({
  offer,
  disabled,
  onAccept,
}: {
  offer: HelpOfferView;
  disabled: boolean;
  onAccept: () => void;
}) {
  return (
    <div
      className="rounded-2xl border p-4"
      style={{ borderColor: "var(--line)", background: "var(--surface)" }}
    >
      <p className="text-sm leading-relaxed">
        <span className="font-semibold">{offer.guardianName}</span>{" "}
        {formatDayLabelTr(offer.proposedDate)} {offer.proposedTimeLocal}
        &apos;de yardım edebilir.
      </p>
      {offer.note ? (
        <p className="mt-2 text-sm" style={{ color: "var(--muted)" }}>
          {offer.note}
        </p>
      ) : null}
      <button
        type="button"
        disabled={disabled}
        onClick={onAccept}
        className="mt-3 inline-flex min-h-11 items-center justify-center rounded-2xl px-4 text-sm font-semibold"
        style={{ background: "var(--accent)", color: "white" }}
      >
        Kabul et
      </button>
    </div>
  );
}
