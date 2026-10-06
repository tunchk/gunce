"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

/**
 * Visibility-aware unread badge poller (no websockets).
 */
export function NotificationBell({ href }: { href: string }) {
  const [unread, setUnread] = useState(0);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/notifications?countOnly=1", {
        cache: "no-store",
      });
      if (!res.ok) return;
      const data = (await res.json()) as { unreadCount?: number };
      setUnread(typeof data.unreadCount === "number" ? data.unreadCount : 0);
    } catch {
      // Ignore transient network errors for badge polling.
    }
  }, []);

  useEffect(() => {
    void refresh();
    function onVis() {
      if (document.visibilityState === "visible") void refresh();
    }
    document.addEventListener("visibilitychange", onVis);
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, 45_000);
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      window.clearInterval(timer);
    };
  }, [refresh]);

  return (
    <Link
      href={href}
      className="relative inline-flex min-h-11 min-w-11 items-center justify-center rounded-2xl px-3 text-sm font-semibold"
      style={{ border: "1px solid var(--line)" }}
      aria-label={
        unread > 0 ? `Bildirimler, ${unread} okunmamış` : "Bildirimler"
      }
    >
      <span aria-hidden>🔔</span>
      {unread > 0 ? (
        <span
          className="absolute -right-1 -top-1 inline-flex min-h-5 min-w-5 items-center justify-center rounded-full px-1 text-xs font-bold text-white"
          style={{ background: "var(--danger)" }}
        >
          {unread > 99 ? "99+" : unread}
        </span>
      ) : null}
    </Link>
  );
}
