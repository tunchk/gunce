"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button, FieldError } from "@/components/ui";
import type { FamilyEventType } from "@prisma/client";
import { FAMILY_EVENT_TYPES } from "@/lib/family-calendar-types";
import { familyEventTypeLabel } from "@/lib/family-calendar-labels";

const TYPE_OPTIONS = FAMILY_EVENT_TYPES.map((t) => ({
  value: t,
  label: familyEventTypeLabel(t),
}));

export function FamilyEventForm({
  mode,
  apiBase,
  childId,
  initial,
  cancelHref,
}: {
  mode: "create" | "edit";
  apiBase: "/api/child/family-events" | "/api/parent/family-events";
  childId?: string;
  initial?: {
    id?: string;
    title?: string;
    eventDate?: string;
    startTimeLocal?: string | null;
    endTimeLocal?: string | null;
    eventType?: FamilyEventType;
    note?: string;
  };
  cancelHref: string;
}) {
  const router = useRouter();
  const [title, setTitle] = useState(initial?.title ?? "");
  const [eventDate, setEventDate] = useState(initial?.eventDate ?? "");
  const [startTimeLocal, setStart] = useState(initial?.startTimeLocal ?? "");
  const [endTimeLocal, setEnd] = useState(initial?.endTimeLocal ?? "");
  const [eventType, setEventType] = useState<FamilyEventType>(
    initial?.eventType ?? "FAMILY",
  );
  const [note, setNote] = useState(initial?.note ?? "");
  const [error, setError] = useState<string>();
  const [pending, setPending] = useState(false);

  async function submit() {
    if (!title.trim() || !eventDate) {
      setError("Başlık ve tarih gerekli.");
      return;
    }
    setPending(true);
    setError(undefined);
    try {
      const payload = {
        ...(childId ? { childId } : {}),
        title,
        eventDate,
        startTimeLocal: startTimeLocal || null,
        endTimeLocal: endTimeLocal || null,
        eventType,
        note,
      };
      const res =
        mode === "create"
          ? await fetch(apiBase, {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify(payload),
            })
          : await fetch(`${apiBase}/${initial!.id}`, {
              method: "PATCH",
              headers: { "content-type": "application/json" },
              body: JSON.stringify(payload),
            });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) {
        setError(data.error || "Kaydedilemedi.");
        setPending(false);
        return;
      }
      setPending(false);
      router.push(cancelHref);
      router.refresh();
    } catch {
      setError("Bağlantı hatası.");
      setPending(false);
    }
  }

  async function cancelEvent() {
    if (!initial?.id) return;
    setPending(true);
    setError(undefined);
    try {
      const res = await fetch(`${apiBase}/${initial.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ op: "cancel" }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) {
        setError(data.error || "İptal edilemedi.");
        setPending(false);
        return;
      }
      setPending(false);
      router.push(cancelHref);
      router.refresh();
    } catch {
      setError("Bağlantı hatası.");
      setPending(false);
    }
  }

  return (
    <div className="space-y-4">
      <label className="block space-y-1">
        <span className="text-sm font-semibold">Başlık</span>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          maxLength={80}
          className="min-h-12 w-full rounded-2xl border px-3"
          style={{ borderColor: "var(--line)" }}
          placeholder="Örn. Dişçi"
        />
      </label>
      <label className="block space-y-1">
        <span className="text-sm font-semibold">Tarih</span>
        <input
          type="date"
          value={eventDate}
          onChange={(e) => setEventDate(e.target.value)}
          className="min-h-12 w-full rounded-2xl border px-3"
          style={{ borderColor: "var(--line)" }}
        />
      </label>
      <div className="grid grid-cols-2 gap-3">
        <label className="block space-y-1">
          <span className="text-sm font-semibold">Başlangıç (isteğe bağlı)</span>
          <input
            type="time"
            value={startTimeLocal}
            onChange={(e) => setStart(e.target.value)}
            className="min-h-12 w-full rounded-2xl border px-3"
            style={{ borderColor: "var(--line)" }}
          />
        </label>
        <label className="block space-y-1">
          <span className="text-sm font-semibold">Bitiş (isteğe bağlı)</span>
          <input
            type="time"
            value={endTimeLocal}
            onChange={(e) => setEnd(e.target.value)}
            className="min-h-12 w-full rounded-2xl border px-3"
            style={{ borderColor: "var(--line)" }}
          />
        </label>
      </div>
      <fieldset className="space-y-2">
        <legend className="text-sm font-semibold">Tür</legend>
        <div className="flex flex-wrap gap-2">
          {TYPE_OPTIONS.map((opt) => (
            <label
              key={opt.value}
              className="inline-flex min-h-11 items-center gap-2 rounded-2xl border px-3 text-sm"
              style={{
                borderColor: eventType === opt.value ? "var(--accent)" : "var(--line)",
                background: eventType === opt.value ? "var(--accent-soft)" : "white",
              }}
            >
              <input
                type="radio"
                name="eventType"
                value={opt.value}
                checked={eventType === opt.value}
                onChange={() => setEventType(opt.value)}
                className="sr-only"
              />
              {opt.label}
            </label>
          ))}
        </div>
      </fieldset>
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
        {pending ? "Kaydediliyor…" : mode === "create" ? "Ekle" : "Kaydet"}
      </Button>
      {mode === "edit" ? (
        <Button
          type="button"
          variant="ghost"
          disabled={pending}
          onClick={() => void cancelEvent()}
        >
          Etkinliği iptal et
        </Button>
      ) : null}
      <Link href={cancelHref} className="ml-3 inline-flex min-h-12 items-center font-semibold underline">
        Vazgeç
      </Link>
    </div>
  );
}
