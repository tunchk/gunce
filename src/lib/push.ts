import webpush from "web-push";

export type PushSubscriptionKeys = {
  endpoint: string;
  p256dh: string;
  auth: string;
};

export type PushSendResult =
  | { status: "accepted" }
  | { status: "gone" }
  | { status: "failed"; code: string };

export type PushAdapter = {
  isConfigured(): boolean;
  send(
    subscription: PushSubscriptionKeys,
    payload: { title: string; body: string; tag: string; url: string },
  ): Promise<PushSendResult>;
};

let adapterOverride: PushAdapter | null = null;

export function setPushAdapterForTests(adapter: PushAdapter | null) {
  adapterOverride = adapter;
}

export function getVapidPublicKey(): string {
  return process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY?.trim() || "";
}

export function isWebPushConfigured(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY?.trim() &&
      process.env.VAPID_PRIVATE_KEY?.trim() &&
      process.env.VAPID_SUBJECT?.trim(),
  );
}

function createWebPushAdapter(): PushAdapter {
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY?.trim() || "";
  const privateKey = process.env.VAPID_PRIVATE_KEY?.trim() || "";
  const subject = process.env.VAPID_SUBJECT?.trim() || "";

  if (publicKey && privateKey && subject) {
    webpush.setVapidDetails(subject, publicKey, privateKey);
  }

  return {
    isConfigured() {
      return Boolean(publicKey && privateKey && subject);
    },
    async send(subscription, payload) {
      if (!this.isConfigured()) {
        return { status: "failed", code: "NOT_CONFIGURED" };
      }
      try {
        await webpush.sendNotification(
          {
            endpoint: subscription.endpoint,
            keys: { p256dh: subscription.p256dh, auth: subscription.auth },
          },
          JSON.stringify({
            title: payload.title,
            body: payload.body,
            tag: payload.tag,
            data: { url: payload.url },
          }),
          { TTL: 60 * 30, urgency: "normal" },
        );
        return { status: "accepted" };
      } catch (error) {
        const statusCode =
          error && typeof error === "object" && "statusCode" in error
            ? Number((error as { statusCode?: number }).statusCode)
            : 0;
        if (statusCode === 404 || statusCode === 410) {
          return { status: "gone" };
        }
        return { status: "failed", code: statusCode ? `HTTP_${statusCode}` : "SEND_FAILED" };
      }
    },
  };
}

export function getPushAdapter(): PushAdapter {
  if (adapterOverride) return adapterOverride;
  return createWebPushAdapter();
}

/** Generic lock-screen copy — no private content. */
export const REMINDER_COPY = {
  journal: {
    title: "Günce",
    body: "Gününden bir şey anlatmak ister misin?",
    tag: "gunce-journal-reminder",
    url: "/cocuk/gunluk/yeni",
  },
  study: {
    title: "Günce",
    body: "Planındaki küçük adım için bir hatırlatma.",
    tag: "gunce-study-reminder",
    url: "/cocuk/haftam",
  },
  test: {
    title: "Günce",
    body: "Bu bir deneme bildirimi.",
    tag: "gunce-test-reminder",
    url: "/cocuk/hatirlatmalar",
  },
} as const;
