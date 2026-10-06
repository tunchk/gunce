"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui";

type Item = {
  id: string;
  title: string;
  body: string;
  href: string;
  readAt: string | null;
  createdAt: string;
};

export function NotificationCenter({ homeHref }: { homeHref: string }) {
  const [filter, setFilter] = useState<"unread" | "all">("unread");
  const [items, setItems] = useState<Item[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | undefined>();
  const [pending, setPending] = useState(false);

  const load = useCallback(
    async (opts?: { append?: boolean; cursor?: string | null }) => {
      setError(undefined);
      if (!opts?.append) setLoading(true);
      try {
        const params = new URLSearchParams({
          filter: filter === "unread" ? "unread" : "all",
        });
        if (opts?.cursor) params.set("cursor", opts.cursor);
        const res = await fetch(`/api/notifications?${params}`, {
          cache: "no-store",
        });
        const data = (await res.json()) as {
          items?: Item[];
          nextCursor?: string | null;
          error?: string;
        };
        if (!res.ok) {
          setError(data.error || "Bildirimler yüklenemedi.");
          return;
        }
        setItems((prev) =>
          opts?.append ? [...prev, ...(data.items ?? [])] : data.items ?? [],
        );
        setNextCursor(data.nextCursor ?? null);
      } catch {
        setError("Bağlantı hatası.");
      } finally {
        setLoading(false);
      }
    },
    [filter],
  );

  useEffect(() => {
    void load();
  }, [load]);

  async function openItem(item: Item) {
    if (!item.readAt) {
      try {
        await fetch("/api/notifications", {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ op: "read", notificationId: item.id }),
        });
        setItems((prev) =>
          prev.map((p) =>
            p.id === item.id ? { ...p, readAt: new Date().toISOString() } : p,
          ),
        );
      } catch {
        // Navigation still proceeds.
      }
    }
    window.location.href = item.href;
  }

  async function markAll() {
    setPending(true);
    try {
      const res = await fetch("/api/notifications", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ op: "read_all" }),
      });
      if (res.ok) await load();
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2" role="tablist" aria-label="Bildirim filtresi">
        <button
          type="button"
          role="tab"
          aria-selected={filter === "unread"}
          onClick={() => setFilter("unread")}
          className="min-h-11 rounded-2xl px-4 text-sm font-semibold"
          style={{
            background: filter === "unread" ? "var(--accent-soft)" : "transparent",
            border: "1px solid var(--line)",
          }}
        >
          Yeni
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={filter === "all"}
          onClick={() => setFilter("all")}
          className="min-h-11 rounded-2xl px-4 text-sm font-semibold"
          style={{
            background: filter === "all" ? "var(--accent-soft)" : "transparent",
            border: "1px solid var(--line)",
          }}
        >
          Tümü
        </button>
        <Button
          type="button"
          variant="ghost"
          disabled={pending}
          onClick={() => void markAll()}
          className="ml-auto"
        >
          Tümünü okundu işaretle
        </Button>
      </div>

      {loading ? (
        <p className="text-sm" style={{ color: "var(--muted)" }} role="status">
          Yükleniyor…
        </p>
      ) : null}
      {error ? (
        <p className="text-sm" style={{ color: "var(--danger)" }} role="alert">
          {error}
        </p>
      ) : null}
      {!loading && !error && items.length === 0 ? (
        <p className="text-sm" style={{ color: "var(--muted)" }} role="status">
          {filter === "unread"
            ? "Okunmamış bildirimin yok."
            : "Henüz bildirim yok."}
        </p>
      ) : null}

      <ul className="space-y-2">
        {items.map((item) => (
          <li key={item.id}>
            <button
              type="button"
              onClick={() => void openItem(item)}
              className="flex w-full flex-col items-start gap-1 rounded-2xl border p-4 text-left"
              style={{
                borderColor: "var(--line)",
                background: item.readAt ? "transparent" : "var(--accent-soft)",
              }}
            >
              <span className="font-semibold">{item.title}</span>
              {item.body ? (
                <span className="text-sm" style={{ color: "var(--muted)" }}>
                  {item.body}
                </span>
              ) : null}
              <span className="text-xs" style={{ color: "var(--muted)" }}>
                {new Date(item.createdAt).toLocaleString("tr-TR")}
                {item.readAt ? "" : " · Yeni"}
              </span>
            </button>
          </li>
        ))}
      </ul>

      {nextCursor ? (
        <Button
          type="button"
          variant="secondary"
          onClick={() => void load({ append: true, cursor: nextCursor })}
        >
          Daha fazla
        </Button>
      ) : null}

      <Link href={homeHref} className="inline-flex min-h-11 items-center font-semibold underline">
        Ana ekrana dön
      </Link>
    </div>
  );
}
