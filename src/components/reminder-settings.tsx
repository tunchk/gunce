"use client";

import { useEffect, useMemo, useState } from "react";
import type { ReminderPreferencesView } from "@/lib/reminder";

type DeviceStatus = {
  deviceRegistered: boolean;
  pushConfigured: boolean;
  subscriptionCount: number;
};

function urlBase64ToUint8Array(base64String: string) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

function detectIosHomeScreenNeeded(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent || "";
  const iOS = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  if (!iOS) return false;
  const standalone =
    ("standalone" in navigator && Boolean((navigator as { standalone?: boolean }).standalone)) ||
    window.matchMedia("(display-mode: standalone)").matches;
  return !standalone;
}

export function ReminderSettingsPanel({
  initialPreferences,
  initialDevice,
  vapidPublicKey,
  pushConfigured,
}: {
  initialPreferences: ReminderPreferencesView;
  initialDevice: DeviceStatus;
  vapidPublicKey: string | null;
  pushConfigured: boolean;
}) {
  const [prefs, setPrefs] = useState(initialPreferences);
  const [device, setDevice] = useState(initialDevice);
  const [permission, setPermission] = useState<NotificationPermission | "unsupported">(
    "default",
  );
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string>();
  const [error, setError] = useState<string>();

  const pushSupported = useMemo(() => {
    return (
      typeof window !== "undefined" &&
      "serviceWorker" in navigator &&
      "PushManager" in window &&
      "Notification" in window
    );
  }, []);

  const iosNeedsInstall = useMemo(() => detectIosHomeScreenNeeded(), []);

  useEffect(() => {
    if (!pushSupported) {
      setPermission("unsupported");
      return;
    }
    setPermission(Notification.permission);
  }, [pushSupported]);

  async function savePrefs(patch: Partial<ReminderPreferencesView>) {
    const previous = prefs;
    const optimistic = { ...prefs, ...patch };
    setPrefs(optimistic);
    setBusy(true);
    setError(undefined);
    setMsg(undefined);
    try {
      const res = await fetch("/api/child/reminders", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          expectedRevision: previous.revision,
          ...patch,
        }),
      });
      const data = (await res.json()) as {
        preferences?: ReminderPreferencesView;
        error?: string;
      };
      if (!res.ok || !data.preferences) {
        setPrefs(previous);
        setError(data.error || "Kaydedilemedi.");
        setBusy(false);
        return;
      }
      setPrefs(data.preferences);
      setMsg("Ayarlar kaydedildi.");
    } catch {
      setPrefs(previous);
      setError("Bağlantı hatası.");
    } finally {
      setBusy(false);
    }
  }

  async function enableDeviceNotifications() {
    setBusy(true);
    setError(undefined);
    setMsg(undefined);
    try {
      if (!pushSupported) {
        setError("Bu tarayıcı bildirimleri desteklemiyor.");
        setBusy(false);
        return;
      }
      if (!pushConfigured || !vapidPublicKey) {
        setError("Bildirimler sunucuda yapılandırılmamış. Ayarların kaydedilebilir.");
        setBusy(false);
        return;
      }
      if (iosNeedsInstall) {
        setError(
          "iPhone/iPad’de bildirimler için önce Ana Ekrana eklemen gerekir (Paylaş → Ana Ekrana Ekle), sonra bu uygulamayı oradan aç.",
        );
        setBusy(false);
        return;
      }

      const reg = await navigator.serviceWorker.register("/sw.js", { scope: "/" });
      await navigator.serviceWorker.ready;

      const perm = await Notification.requestPermission();
      setPermission(perm);
      if (perm !== "granted") {
        setError(
          perm === "denied"
            ? "Bildirim izni reddedildi. Diğer özellikler çalışmaya devam eder."
            : "Bildirim izni verilmedi.",
        );
        setBusy(false);
        return;
      }

      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidPublicKey),
      });
      const json = sub.toJSON();
      const res = await fetch("/api/child/reminders/push", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          endpoint: json.endpoint,
          keys: json.keys,
          userAgent: navigator.userAgent,
        }),
      });
      const data = (await res.json()) as { error?: string; ok?: boolean };
      if (!res.ok) {
        setError(data.error || "Cihaz kaydı başarısız.");
        setBusy(false);
        return;
      }
      setDevice((d) => ({ ...d, deviceRegistered: true, subscriptionCount: d.subscriptionCount + 1 }));
      setMsg("Bu cihaz bildirimler için kaydedildi.");
    } catch {
      setError("Bildirim açılamadı. Diğer özellikler duruyor.");
    } finally {
      setBusy(false);
    }
  }

  async function sendTest() {
    setBusy(true);
    setError(undefined);
    setMsg(undefined);
    try {
      const res = await fetch("/api/child/reminders/push", { method: "PUT" });
      const data = (await res.json()) as { error?: string; ok?: boolean };
      if (!res.ok) {
        setError(data.error || "Deneme gönderilemedi.");
        setBusy(false);
        return;
      }
      setMsg("Deneme bildirimi gönderildi (kabul edildi). Ekranda görünmesi tarayıcıya bağlıdır.");
    } catch {
      setError("Bağlantı hatası.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Uygulama tercihleri</h2>
        <p className="text-sm" style={{ color: "var(--muted)" }}>
          Hatırlatmalar varsayılan olarak kapalıdır. Tercihler bu hesap içindir.
        </p>

        <label className="flex items-center gap-3 min-h-12">
          <input
            type="checkbox"
            checked={prefs.journalReminderEnabled}
            disabled={busy}
            onChange={(e) =>
              void savePrefs({ journalReminderEnabled: e.target.checked })
            }
          />
          <span>Günlük yazma daveti</span>
        </label>
        <label className="block text-sm font-semibold">
          Günlük davet saati (yerel)
          <input
            type="time"
            className="mt-1 w-full rounded-xl border px-3 py-3"
            style={{ borderColor: "var(--line)" }}
            value={prefs.journalReminderLocalTime}
            disabled={busy || !prefs.journalReminderEnabled}
            onChange={(e) =>
              setPrefs((p) => ({ ...p, journalReminderLocalTime: e.target.value }))
            }
            onBlur={() =>
              void savePrefs({
                journalReminderLocalTime: prefs.journalReminderLocalTime,
              })
            }
          />
        </label>

        <label className="flex items-center gap-3 min-h-12">
          <input
            type="checkbox"
            checked={prefs.studyRemindersEnabled}
            disabled={busy}
            onChange={(e) =>
              void savePrefs({ studyRemindersEnabled: e.target.checked })
            }
          />
          <span>Çalışma adımı hatırlatmaları (genel)</span>
        </label>

        <div className="grid grid-cols-2 gap-3">
          <label className="block text-sm font-semibold">
            Sessiz başlangıç
            <input
              type="time"
              className="mt-1 w-full rounded-xl border px-3 py-3"
              style={{ borderColor: "var(--line)" }}
              value={prefs.quietHoursStart}
              disabled={busy}
              onChange={(e) =>
                setPrefs((p) => ({ ...p, quietHoursStart: e.target.value }))
              }
              onBlur={() => void savePrefs({ quietHoursStart: prefs.quietHoursStart })}
            />
          </label>
          <label className="block text-sm font-semibold">
            Sessiz bitiş
            <input
              type="time"
              className="mt-1 w-full rounded-xl border px-3 py-3"
              style={{ borderColor: "var(--line)" }}
              value={prefs.quietHoursEnd}
              disabled={busy}
              onChange={(e) =>
                setPrefs((p) => ({ ...p, quietHoursEnd: e.target.value }))
              }
              onBlur={() => void savePrefs({ quietHoursEnd: prefs.quietHoursEnd })}
            />
          </label>
        </div>
        <p className="text-sm" style={{ color: "var(--muted)" }}>
          Varsayılan sessiz saatler 21:00–08:00 (geceyi kapsar). Sessiz saatteki hatırlatmalar
          aynı gün izin verilen ilk saate ertelenir; olmazsa o gün atlanır.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Bu cihaz</h2>
        <ul className="text-sm space-y-1" style={{ color: "var(--muted)" }}>
          <li>
            Tarayıcı izni:{" "}
            {permission === "unsupported"
              ? "desteklenmiyor"
              : permission === "granted"
                ? "açık"
                : permission === "denied"
                  ? "reddedildi"
                  : "sorulmadı"}
          </li>
          <li>
            Cihaz kaydı: {device.deviceRegistered ? "kayıtlı" : "yok"}
          </li>
          <li>
            Sunucu yapılandırması: {pushConfigured ? "hazır" : "eksik (VAPID)"}
          </li>
        </ul>

        {!pushSupported ? (
          <p className="text-sm" style={{ color: "var(--muted)" }}>
            Bu tarayıcı Web Push desteklemiyor. Hatırlatma tercihlerini yine de kaydedebilirsin.
          </p>
        ) : null}

        {iosNeedsInstall ? (
          <p className="text-sm rounded-xl border p-3" style={{ borderColor: "var(--line)" }}>
            iPhone/iPad: Bildirimler için siteyi <strong>Ana Ekrana Ekle</strong>, sonra o ikondan
            aç. (iOS 16.4+; resmi WebKit / Web Push gereksinimi.)
          </p>
        ) : null}

        {!pushConfigured ? (
          <p className="text-sm" style={{ color: "var(--warn)" }}>
            Bildirim gönderimi yapılandırılmamış. Tercihler saklanır; başarılı gönderim
            simüle edilmez.
          </p>
        ) : null}

        <button
          type="button"
          disabled={busy}
          onClick={() => void enableDeviceNotifications()}
          className="inline-flex min-h-12 w-full items-center justify-center rounded-2xl px-4 font-semibold disabled:opacity-50"
          style={{ background: "var(--accent)", color: "white" }}
        >
          Bu cihazda bildirimleri aç
        </button>

        <button
          type="button"
          disabled={busy || !device.deviceRegistered || !pushConfigured}
          onClick={() => void sendTest()}
          className="inline-flex min-h-12 w-full items-center justify-center rounded-2xl px-4 font-semibold disabled:opacity-50"
          style={{ background: "var(--accent-soft)" }}
        >
          Deneme bildirimi gönder
        </button>
      </section>

      {msg ? (
        <p className="text-sm" role="status" style={{ color: "var(--muted)" }}>
          {msg}
        </p>
      ) : null}
      {error ? (
        <p className="text-sm" role="alert" style={{ color: "var(--danger)" }}>
          {error}
        </p>
      ) : null}
    </div>
  );
}
