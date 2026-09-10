"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  excerptSharedText,
  formatDiaryDate,
  type ParentSharedItem,
} from "@/lib/journal-view";
import { Panel } from "@/components/ui";

function SharedMessageCard({ item }: { item: ParentSharedItem }) {
  const excerpt = excerptSharedText(item.parentMessage);

  return (
    <article
      className="rounded-2xl border p-4"
      style={{ borderColor: "var(--line)", background: "rgba(255,255,255,0.7)" }}
    >
      <header className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <p className="font-semibold">{item.childDisplayName}</p>
        <p className="text-xs" style={{ color: "var(--muted)" }}>
          {formatDiaryDate(new Date(`${item.diaryDate}T00:00:00.000Z`))}
        </p>
      </header>
      <p className="whitespace-pre-wrap text-sm leading-relaxed">{excerpt}</p>
      <div className="mt-3">
        <Link
          href={`/veli/paylasim/${item.shareId}`}
          className="inline-flex min-h-11 items-center justify-center rounded-2xl px-4 text-sm font-semibold"
          style={{ background: "var(--accent-soft)", color: "var(--ink)" }}
        >
          Detayı gör
        </Link>
      </div>
    </article>
  );
}

function SupportRequestCard({ item }: { item: ParentSharedItem }) {
  return (
    <article
      className="rounded-2xl border p-4"
      style={{ borderColor: "var(--line)", background: "rgba(255,255,255,0.7)" }}
    >
      <header className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <p className="font-semibold">{item.childDisplayName}</p>
        <p className="text-xs" style={{ color: "var(--muted)" }}>
          {formatDiaryDate(new Date(`${item.diaryDate}T00:00:00.000Z`))}
        </p>
      </header>
      <p className="whitespace-pre-wrap text-sm leading-relaxed">{item.supportRequest}</p>
      <div className="mt-3">
        <Link
          href={`/veli/paylasim/${item.shareId}`}
          className="inline-flex min-h-11 items-center font-semibold underline"
        >
          Paylaşım detayı
        </Link>
      </div>
    </article>
  );
}

function GuidanceTeaser({ items }: { items: ParentSharedItem[] }) {
  const withContent = items.filter(
    (i) => i.parentMessage.trim() || i.supportRequest.trim(),
  );
  if (withContent.length === 0) {
    return (
      <p className="text-sm leading-relaxed" style={{ color: "var(--muted)" }}>
        Paylaşım olduğunda burada yaklaşım önerilerine gidebilirsin.
      </p>
    );
  }

  return (
    <ul className="space-y-3">
      {withContent.slice(0, 5).map((item) => (
        <li
          key={`g-${item.shareId}`}
          className="rounded-2xl border p-3"
          style={{ borderColor: "var(--line)", background: "rgba(255,255,255,0.55)" }}
        >
          <p className="text-sm font-semibold">{item.childDisplayName}</p>
          {item.guidanceOpener ? (
            <>
              <p className="mt-1 text-xs font-semibold" style={{ color: "var(--muted)" }}>
                AI önerisi · Paylaşılanlara dayanır
              </p>
              <p className="mt-1 text-sm leading-relaxed">{item.guidanceOpener}</p>
            </>
          ) : (
            <p className="mt-1 text-sm" style={{ color: "var(--muted)" }}>
              Bu paylaşım için detayda yaklaşım önerisi görebilirsin.
            </p>
          )}
          <Link
            href={`/veli/paylasim/${item.shareId}`}
            className="mt-2 inline-flex min-h-11 items-center text-sm font-semibold underline"
          >
            Detayı gör
          </Link>
        </li>
      ))}
    </ul>
  );
}

export function ParentSharedSections({
  messages,
  supportRequests,
}: {
  messages: ParentSharedItem[];
  supportRequests: ParentSharedItem[];
}) {
  const allForGuidance = [...messages];
  for (const s of supportRequests) {
    if (!allForGuidance.some((m) => m.shareId === s.shareId)) {
      allForGuidance.push(s);
    }
  }

  return (
    <>
      <Panel>
        <h2 className="text-lg font-semibold">Benimle paylaştıkları</h2>
        {messages.length === 0 ? (
          <p className="mt-2 text-sm leading-relaxed" style={{ color: "var(--muted)" }}>
            Henüz seninle paylaşılmış bir mesaj yok. Çocuk paylaşana kadar burada bir şey görünmez.
          </p>
        ) : (
          <div className="mt-3 space-y-3">
            {messages.map((item) => (
              <SharedMessageCard key={`m-${item.shareId}`} item={item} />
            ))}
          </div>
        )}
      </Panel>

      <Panel>
        <h2 className="text-lg font-semibold">Nasıl destek olabilirim?</h2>

        <section className="mt-4 space-y-2">
          <h3 className="text-base font-semibold">Çocuğunun destek isteği</h3>
          {supportRequests.length === 0 ? (
            <p className="text-sm leading-relaxed" style={{ color: "var(--muted)" }}>
              Açık bir destek isteği yok.
            </p>
          ) : (
            <div className="space-y-3">
              {supportRequests.map((item) => (
                <SupportRequestCard key={`s-${item.shareId}`} item={item} />
              ))}
            </div>
          )}
        </section>

        <section className="mt-5 space-y-2">
          <h3 className="text-base font-semibold">Yaklaşım önerileri</h3>
          <p className="text-xs font-semibold" style={{ color: "var(--muted)" }}>
            AI önerisi · Paylaşılanlara dayanır
          </p>
          <GuidanceTeaser items={allForGuidance} />
        </section>
      </Panel>
    </>
  );
}

export function ParentGuidancePanel({ shareId }: { shareId: string }) {
  const [status, setStatus] = useState<"loading" | "ready" | "unavailable" | "failed">(
    "loading",
  );
  const [opener, setOpener] = useState("");
  const [action, setAction] = useState("");
  const [reason, setReason] = useState<string | undefined>();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/parent/shared/${shareId}`, { method: "POST" });
        const data = (await res.json()) as {
          guidance?: {
            available?: boolean;
            conversationOpener?: string;
            supportAction?: string;
            reason?: string;
            label?: string;
          };
          error?: string;
        };
        if (cancelled) return;
        if (res.status === 404) {
          setStatus("failed");
          setReason(data.error || "Paylaşım bulunamadı.");
          return;
        }
        if (!res.ok) {
          setStatus("unavailable");
          setReason(data.error || "Yaklaşım önerisi alınamadı.");
          return;
        }
        if (data.guidance && data.guidance.available === false) {
          setStatus("unavailable");
          setReason(data.guidance.reason);
          return;
        }
        if (
          data.guidance?.available &&
          data.guidance.conversationOpener &&
          data.guidance.supportAction
        ) {
          setOpener(data.guidance.conversationOpener);
          setAction(data.guidance.supportAction);
          setStatus("ready");
          return;
        }
        setStatus("unavailable");
        setReason("Yaklaşım önerisi şu an yok.");
      } catch {
        if (!cancelled) {
          setStatus("unavailable");
          setReason("Bağlantı hatası. Paylaşılan metin yine de okunabilir.");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [shareId]);

  return (
    <section className="space-y-3">
      <h2 className="text-lg font-semibold">Yaklaşım önerileri</h2>
      <p className="text-xs font-semibold" style={{ color: "var(--muted)" }}>
        AI önerisi · Paylaşılanlara dayanır
      </p>
      {status === "loading" ? (
        <p className="text-sm" style={{ color: "var(--muted)" }}>
          Öneri hazırlanıyor…
        </p>
      ) : null}
      {status === "ready" ? (
        <ul className="space-y-3">
          <li
            className="rounded-2xl border p-4 text-sm leading-relaxed"
            style={{ borderColor: "var(--line)", background: "rgba(255,255,255,0.7)" }}
          >
            <p className="text-xs font-semibold" style={{ color: "var(--muted)" }}>
              Konuşma açıcı
            </p>
            <p className="mt-1">{opener}</p>
          </li>
          <li
            className="rounded-2xl border p-4 text-sm leading-relaxed"
            style={{ borderColor: "var(--line)", background: "rgba(255,255,255,0.7)" }}
          >
            <p className="text-xs font-semibold" style={{ color: "var(--muted)" }}>
              Küçük destek adımı
            </p>
            <p className="mt-1">{action}</p>
          </li>
        </ul>
      ) : null}
      {status === "unavailable" || status === "failed" ? (
        <p className="text-sm leading-relaxed" style={{ color: "var(--muted)" }}>
          {reason || "Yaklaşım önerisi kullanılamıyor. Paylaşılan içerik yine de burada."}
        </p>
      ) : null}
    </section>
  );
}
