"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

export type LeaveDecision = "proceed" | "stay";

export type TextGuard = {
  /** True when local text differs from last successful persist, or a save is in flight/failed. */
  isDirty: () => boolean;
  /** Attempt to persist. Never reports success on failure/conflict. */
  flush: () => Promise<"saved" | "clean" | "failed" | "conflict">;
  /** Drop local edits back to last persisted text (explicit discard). */
  discardLocal: () => void;
};

export type VoiceGuard = {
  isBlocking: () => boolean;
  message: () => string;
  /** Stop mic, clear in-memory audio, ignore late transcription callbacks. */
  discard: () => void;
};

type LeavePrompt =
  | {
      kind: "voice";
      href: string | null;
      message: string;
      afterVoice?: "navigate" | "back";
    }
  | {
      kind: "save-failed";
      href: string | null;
      message: string;
      afterDiscard?: "navigate" | "back";
    }
  | {
      kind: "conflict";
      message: string;
    };

type NavigationGuardContextValue = {
  registerTextGuard: (guard: TextGuard | null) => void;
  registerVoiceGuard: (guard: VoiceGuard | null) => void;
  tryNavigate: (href: string) => Promise<LeaveDecision>;
};

const NavigationGuardContext = createContext<NavigationGuardContextValue | null>(
  null,
);

function hrefString(href: string | { pathname?: string }): string {
  if (typeof href === "string") return href;
  return href.pathname || "/";
}

export function NavigationGuardProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const textGuardRef = useRef<TextGuard | null>(null);
  const voiceGuardRef = useRef<VoiceGuard | null>(null);
  const busyRef = useRef(false);
  const [prompt, setPrompt] = useState<LeavePrompt | null>(null);
  const [busyLabel, setBusyLabel] = useState<string | null>(null);
  const allowNextPopRef = useRef(false);
  const sentinelActiveRef = useRef(false);

  const registerTextGuard = useCallback((guard: TextGuard | null) => {
    textGuardRef.current = guard;
  }, []);

  const registerVoiceGuard = useCallback((guard: VoiceGuard | null) => {
    voiceGuardRef.current = guard;
  }, []);

  const needsGuard = useCallback(() => {
    const voice = voiceGuardRef.current?.isBlocking() === true;
    const text = textGuardRef.current?.isDirty() === true;
    return voice || text;
  }, []);

  const finishNavigate = useCallback(
    (href: string | null, mode: "navigate" | "back") => {
      setPrompt(null);
      setBusyLabel(null);
      if (mode === "back") {
        allowNextPopRef.current = true;
        sentinelActiveRef.current = false;
        router.back();
        return;
      }
      if (href) {
        allowNextPopRef.current = true;
        sentinelActiveRef.current = false;
        router.push(href);
      }
    },
    [router],
  );

  const runLeavePipeline = useCallback(
    async (href: string | null, mode: "navigate" | "back"): Promise<LeaveDecision> => {
      if (busyRef.current) return "stay";
      busyRef.current = true;
      try {
        const voice = voiceGuardRef.current;
        if (voice?.isBlocking()) {
          setPrompt({
            kind: "voice",
            href,
            message: voice.message(),
            afterVoice: mode,
          });
          return "stay";
        }

        const text = textGuardRef.current;
        if (!text || !text.isDirty()) {
          finishNavigate(href, mode);
          return "proceed";
        }

        setBusyLabel("Kaydediliyor…");
        const result = await text.flush();
        setBusyLabel(null);

        if (result === "saved" || result === "clean") {
          finishNavigate(href, mode);
          return "proceed";
        }

        if (result === "conflict") {
          setPrompt({
            kind: "conflict",
            message:
              "Başka bir değişiklik var. Kaydetmeden üzerine yazmıyoruz. Sayfada kal veya sayfayı yenile.",
          });
          return "stay";
        }

        setPrompt({
          kind: "save-failed",
          href,
          message:
            "Kaydedilemedi. Tekrar deneyebilir, sayfada kalabilir veya kaydedilmemiş yazıyı bırakıp çıkabilirsin.",
          afterDiscard: mode,
        });
        return "stay";
      } finally {
        busyRef.current = false;
      }
    },
    [finishNavigate],
  );

  const tryNavigate = useCallback(
    async (href: string) => runLeavePipeline(href, "navigate"),
    [runLeavePipeline],
  );

  // History sentinel for browser Back while a guard is active (best-effort; see docs).
  useEffect(() => {
    function ensureSentinel() {
      if (!needsGuard()) {
        sentinelActiveRef.current = false;
        return;
      }
      if (sentinelActiveRef.current) return;
      window.history.pushState({ __gunceLeaveGuard: true }, "", window.location.href);
      sentinelActiveRef.current = true;
    }

    ensureSentinel();
    const id = window.setInterval(ensureSentinel, 800);

    function onPopState() {
      if (allowNextPopRef.current) {
        allowNextPopRef.current = false;
        return;
      }
      if (!needsGuard()) return;
      // Stay on the journal URL, then run the leave pipeline for Back.
      window.history.pushState({ __gunceLeaveGuard: true }, "", window.location.href);
      sentinelActiveRef.current = true;
      void runLeavePipeline(null, "back");
    }

    window.addEventListener("popstate", onPopState);
    return () => {
      window.clearInterval(id);
      window.removeEventListener("popstate", onPopState);
    };
  }, [needsGuard, runLeavePipeline]);

  const value = useMemo(
    () => ({ registerTextGuard, registerVoiceGuard, tryNavigate }),
    [registerTextGuard, registerVoiceGuard, tryNavigate],
  );

  return (
    <NavigationGuardContext.Provider value={value}>
      {children}
      {busyLabel ? (
        <div
          className="fixed inset-x-0 bottom-24 z-50 mx-auto max-w-[480px] px-4"
          role="status"
          aria-live="polite"
        >
          <p
            className="rounded-2xl px-4 py-3 text-sm font-semibold shadow-lg"
            style={{ background: "var(--accent-soft)", color: "var(--ink)" }}
          >
            {busyLabel}
          </p>
        </div>
      ) : null}
      {prompt ? (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/35 p-4 sm:items-center"
          role="dialog"
          aria-modal="true"
          aria-labelledby="leave-guard-title"
        >
          <div
            className="w-full max-w-[480px] space-y-4 rounded-2xl p-5"
            style={{ background: "white", border: "1px solid var(--line)" }}
          >
            <h2 id="leave-guard-title" className="text-lg font-semibold">
              {prompt.kind === "voice"
                ? "Kaydedilmemiş ses var"
                : prompt.kind === "conflict"
                  ? "Kayıt çakışması"
                  : "Kayıt başarısız"}
            </h2>
            <p className="text-sm leading-relaxed" style={{ color: "var(--muted)" }}>
              {prompt.message}
            </p>
            <div className="flex flex-col gap-2">
              {prompt.kind === "voice" ? (
                <>
                  <button
                    type="button"
                    className="inline-flex min-h-12 items-center justify-center rounded-2xl px-4 font-semibold"
                    style={{ background: "var(--accent)", color: "white" }}
                    onClick={() => setPrompt(null)}
                  >
                    Sayfada kal
                  </button>
                  <button
                    type="button"
                    className="inline-flex min-h-12 items-center justify-center rounded-2xl px-4 font-semibold"
                    style={{ border: "1px solid var(--line)" }}
                    onClick={() => {
                      const href = prompt.href;
                      const mode = prompt.afterVoice || "navigate";
                      voiceGuardRef.current?.discard();
                      setPrompt(null);
                      // Continue leave after explicit voice discard (refs already cleared).
                      void runLeavePipeline(href, mode);
                    }}
                  >
                    Sesi bırak ve çık
                  </button>
                </>
              ) : null}
              {prompt.kind === "save-failed" ? (
                <>
                  <button
                    type="button"
                    className="inline-flex min-h-12 items-center justify-center rounded-2xl px-4 font-semibold"
                    style={{ background: "var(--accent)", color: "white" }}
                    onClick={() => {
                      setPrompt(null);
                      void runLeavePipeline(
                        prompt.href,
                        prompt.afterDiscard || "navigate",
                      );
                    }}
                  >
                    Tekrar kaydetmeyi dene
                  </button>
                  <button
                    type="button"
                    className="inline-flex min-h-12 items-center justify-center rounded-2xl px-4 font-semibold"
                    style={{ border: "1px solid var(--line)" }}
                    onClick={() => setPrompt(null)}
                  >
                    Sayfada kal
                  </button>
                  <button
                    type="button"
                    className="inline-flex min-h-12 items-center justify-center rounded-2xl px-4 font-semibold"
                    style={{ color: "var(--danger)" }}
                    onClick={() => {
                      textGuardRef.current?.discardLocal();
                      finishNavigate(prompt.href, prompt.afterDiscard || "navigate");
                    }}
                  >
                    Kaydetmeden çık
                  </button>
                </>
              ) : null}
              {prompt.kind === "conflict" ? (
                <>
                  <button
                    type="button"
                    className="inline-flex min-h-12 items-center justify-center rounded-2xl px-4 font-semibold"
                    style={{ background: "var(--accent)", color: "white" }}
                    onClick={() => setPrompt(null)}
                  >
                    Sayfada kal
                  </button>
                  <button
                    type="button"
                    className="inline-flex min-h-12 items-center justify-center rounded-2xl px-4 font-semibold"
                    style={{ border: "1px solid var(--line)" }}
                    onClick={() => {
                      window.location.reload();
                    }}
                  >
                    Sayfayı yenile
                  </button>
                </>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </NavigationGuardContext.Provider>
  );
}

export function useNavigationGuard() {
  const ctx = useContext(NavigationGuardContext);
  if (!ctx) {
    return {
      registerTextGuard: () => undefined,
      registerVoiceGuard: () => undefined,
      tryNavigate: async (href: string) => {
        window.location.href = href;
        return "proceed" as const;
      },
      enabled: false as const,
    };
  }
  return { ...ctx, enabled: true as const };
}

export function GuardedLink({
  href,
  children,
  className,
  style,
  "aria-current": ariaCurrent,
  onClick,
}: {
  href: string;
  children: ReactNode;
  className?: string;
  style?: React.CSSProperties;
  "aria-current"?: "page" | undefined;
  onClick?: React.MouseEventHandler<HTMLAnchorElement>;
}) {
  const { tryNavigate, enabled } = useNavigationGuard();
  const target = hrefString(href);

  return (
    <Link
      href={href}
      className={className}
      style={style}
      aria-current={ariaCurrent}
      onClick={(event) => {
        onClick?.(event);
        if (event.defaultPrevented) return;
        if (!enabled) return;
        // Prefer click intercept so leave-guards run before soft navigation.
        event.preventDefault();
        void tryNavigate(target);
      }}
      onNavigate={(event) => {
        if (!enabled) return;
        event.preventDefault();
        void tryNavigate(target);
      }}
    >
      {children}
    </Link>
  );
}
