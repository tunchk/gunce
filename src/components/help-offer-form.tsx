"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button, FieldError } from "@/components/ui";
import type { HelpRequestView } from "@/lib/help-types";
import { formatDayLabelTr } from "@/lib/plan-dates";

export function ParentHelpOfferForm({
  request,
  guardianUserId,
}: {
  request: HelpRequestView;
  guardianUserId: string;
}) {
  const router = useRouter();
  const [date, setDate] = useState("");
  const [time, setTime] = useState("18:00");
  const [note, setNote] = useState("");
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string>();
  const [pending, setPending] = useState(false);

  const myPending = request.offers.find(
    (o) => o.status === "PENDING" && o.guardianUserId === guardianUserId,
  );
  const myAccepted =
    request.status === "ACCEPTED" &&
    request.acceptedOfferId &&
    request.offers.find(
      (o) => o.id === request.acceptedOfferId && o.guardianUserId === guardianUserId,
    );

  async function submit() {
    if (!date || !time) {
      setError("Tarih ve saat seç.");
      return;
    }
    setPending(true);
    setError(undefined);
    try {
      const res = await fetch(`/api/parent/help/${request.id}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          proposedDate: date,
          proposedTimeLocal: time,
          note,
        }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) {
        setError(data.error || "Gönderilemedi.");
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

  async function saveEdit(offerId: string) {
    if (!date || !time) {
      setError("Tarih ve saat seç.");
      return;
    }
    setPending(true);
    setError(undefined);
    try {
      const res = await fetch(`/api/parent/help/${request.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          op: "edit_offer",
          offerId,
          proposedDate: date,
          proposedTimeLocal: time,
        }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) {
        setError(data.error || "Güncellenemedi.");
        setPending(false);
        return;
      }
      setEditing(false);
      setPending(false);
      router.refresh();
    } catch {
      setError("Bağlantı hatası.");
      setPending(false);
    }
  }

  async function withdraw(offerId: string) {
    setPending(true);
    setError(undefined);
    try {
      const res = await fetch(`/api/parent/help/${request.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ op: "withdraw_offer", offerId }),
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

  async function cancelAccepted() {
    setPending(true);
    setError(undefined);
    try {
      const res = await fetch(`/api/parent/help/${request.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ op: "cancel_accepted" }),
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

  if (request.status === "COMPLETED") {
    return (
      <p className="text-sm" style={{ color: "var(--muted)" }}>
        Bu yardım tamamlandı.
      </p>
    );
  }

  if (request.status === "CANCELLED") {
    return (
      <p className="text-sm" style={{ color: "var(--muted)" }}>
        Bu istek iptal edildi.
      </p>
    );
  }

  if (myAccepted) {
    return (
      <div className="space-y-3">
        <p className="text-sm leading-relaxed">
          Planlandı: {formatDayLabelTr(myAccepted.proposedDate)}{" "}
          {myAccepted.proposedTimeLocal}
        </p>
        <p className="text-sm" style={{ color: "var(--muted)" }}>
          Kabul edilen teklif düzenlenemez.
        </p>
        <Button
          type="button"
          variant="ghost"
          disabled={pending}
          onClick={() => void cancelAccepted()}
        >
          Bu yardıma gelemeyeceğim
        </Button>
        {error ? <FieldError message={error} /> : null}
      </div>
    );
  }

  if (request.status === "ACCEPTED") {
    return (
      <p className="text-sm" style={{ color: "var(--muted)" }}>
        Bu istek için başka bir veliyle yardım planlandı.
      </p>
    );
  }

  if (myPending) {
    if (editing) {
      return (
        <div className="space-y-4">
          <h3 className="font-semibold">Teklifi düzenle</h3>
          <label className="block space-y-1">
            <span className="text-sm font-semibold">Tarih</span>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="min-h-12 w-full rounded-2xl border px-3"
              style={{ borderColor: "var(--line)" }}
            />
          </label>
          <label className="block space-y-1">
            <span className="text-sm font-semibold">Saat</span>
            <input
              type="time"
              value={time}
              onChange={(e) => setTime(e.target.value)}
              className="min-h-12 w-full rounded-2xl border px-3"
              style={{ borderColor: "var(--line)" }}
            />
          </label>
          {error ? <FieldError message={error} /> : null}
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              disabled={pending}
              onClick={() => void saveEdit(myPending.id)}
            >
              {pending ? "Kaydediliyor…" : "Kaydet"}
            </Button>
            <Button
              type="button"
              variant="ghost"
              disabled={pending}
              onClick={() => setEditing(false)}
            >
              Vazgeç
            </Button>
          </div>
        </div>
      );
    }

    return (
      <div className="space-y-3">
        <p className="text-sm leading-relaxed">
          Teklifin bekliyor: {formatDayLabelTr(myPending.proposedDate)}{" "}
          {myPending.proposedTimeLocal}
        </p>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="secondary"
            disabled={pending}
            onClick={() => {
              setDate(myPending.proposedDate);
              setTime(myPending.proposedTimeLocal);
              setEditing(true);
            }}
          >
            Düzenle
          </Button>
          <Button
            type="button"
            variant="ghost"
            disabled={pending}
            onClick={() => void withdraw(myPending.id)}
          >
            Teklifi geri al
          </Button>
        </div>
        {error ? <FieldError message={error} /> : null}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <h3 className="font-semibold">Ne zaman yardım edebilirsin?</h3>
      <label className="block space-y-1">
        <span className="text-sm font-semibold">Tarih</span>
        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          className="min-h-12 w-full rounded-2xl border px-3"
          style={{ borderColor: "var(--line)" }}
        />
      </label>
      <label className="block space-y-1">
        <span className="text-sm font-semibold">Saat</span>
        <input
          type="time"
          value={time}
          onChange={(e) => setTime(e.target.value)}
          className="min-h-12 w-full rounded-2xl border px-3"
          style={{ borderColor: "var(--line)" }}
        />
      </label>
      <label className="block space-y-1">
        <span className="text-sm font-semibold">Kısa not (isteğe bağlı)</span>
        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          maxLength={160}
          className="min-h-12 w-full rounded-2xl border px-3"
          style={{ borderColor: "var(--line)" }}
        />
      </label>
      {error ? <FieldError message={error} /> : null}
      <Button type="button" disabled={pending} onClick={() => void submit()}>
        {pending ? "Gönderiliyor…" : "Öner"}
      </Button>
    </div>
  );
}
