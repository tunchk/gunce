"use client";

import { GuardedLink } from "@/components/navigation-guard";
import { usePathname } from "next/navigation";

const ITEMS = [
  {
    href: "/cocuk/ana",
    label: "Ana",
    match: (path: string) => path === "/cocuk/ana" || path === "/cocuk",
    icon: HomeIcon,
  },
  {
    href: "/cocuk/gunluk",
    label: "Günlüğüm",
    match: (path: string) => path.startsWith("/cocuk/gunluk"),
    icon: JournalIcon,
  },
  {
    href: "/cocuk/haftam",
    label: "Planım",
    match: (path: string) =>
      path.startsWith("/cocuk/haftam") || path.startsWith("/cocuk/plan"),
    icon: PlanIcon,
  },
  {
    href: "/cocuk/hedefler",
    label: "Hedeflerim",
    match: (path: string) => path.startsWith("/cocuk/hedefler"),
    icon: GoalIcon,
  },
] as const;

export function ChildNav() {
  const pathname = usePathname() || "";

  return (
    <nav
      aria-label="Çocuk gezinti"
      className="child-nav fixed inset-x-0 bottom-0 z-40 border-t px-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-1"
      style={{
        background: "rgba(255, 255, 255, 0.94)",
        borderColor: "var(--line)",
        backdropFilter: "blur(12px)",
      }}
    >
      <ul className="mx-auto flex max-w-[480px] items-stretch justify-between gap-1">
        {ITEMS.map((item) => {
          const active = item.match(pathname);
          const Icon = item.icon;
          return (
            <li key={item.href} className="flex-1">
              <GuardedLink
                href={item.href}
                aria-current={active ? "page" : undefined}
                className="flex min-h-12 flex-col items-center justify-center gap-0.5 rounded-xl px-1 text-center text-xs font-semibold leading-tight"
                style={{
                  color: active ? "var(--accent)" : "var(--muted)",
                  background: active ? "var(--accent-soft)" : "transparent",
                }}
              >
                <Icon active={active} />
                <span>{item.label}</span>
              </GuardedLink>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

function HomeIcon({ active }: { active: boolean }) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M4 10.5 12 4l8 6.5V20a1 1 0 0 1-1 1h-5v-6H10v6H5a1 1 0 0 1-1-1v-9.5Z"
        stroke="currentColor"
        strokeWidth={active ? 2.2 : 1.8}
        strokeLinejoin="round"
      />
    </svg>
  );
}

function JournalIcon({ active }: { active: boolean }) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M7 3.5h9.5A2.5 2.5 0 0 1 19 6v14.5L12 17l-7 3.5V6A2.5 2.5 0 0 1 7.5 3.5"
        stroke="currentColor"
        strokeWidth={active ? 2.2 : 1.8}
        strokeLinejoin="round"
      />
    </svg>
  );
}

function PlanIcon({ active }: { active: boolean }) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
      <rect
        x="4"
        y="5"
        width="16"
        height="15"
        rx="2"
        stroke="currentColor"
        strokeWidth={active ? 2.2 : 1.8}
      />
      <path
        d="M8 3.5v3M16 3.5v3M4 9.5h16"
        stroke="currentColor"
        strokeWidth={active ? 2.2 : 1.8}
        strokeLinecap="round"
      />
    </svg>
  );
}

function GoalIcon({ active }: { active: boolean }) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle
        cx="12"
        cy="12"
        r="8"
        stroke="currentColor"
        strokeWidth={active ? 2.2 : 1.8}
      />
      <circle
        cx="12"
        cy="12"
        r="4"
        stroke="currentColor"
        strokeWidth={active ? 2.2 : 1.8}
      />
      <circle cx="12" cy="12" r="1.5" fill="currentColor" />
    </svg>
  );
}
