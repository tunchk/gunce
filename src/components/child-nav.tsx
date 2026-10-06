"use client";

import { GuardedLink } from "@/components/navigation-guard";
import { usePathname } from "next/navigation";

const SIDE_ITEMS = [
  {
    href: "/cocuk/ana",
    label: "Bugün",
    match: (path: string) => path === "/cocuk/ana" || path === "/cocuk",
    icon: HomeIcon,
  },
  {
    href: "/cocuk/haftam",
    label: "Haftam",
    match: (path: string) =>
      path.startsWith("/cocuk/haftam") ||
      (path.startsWith("/cocuk/plan") && path !== "/cocuk/plan/yeni"),
    icon: PlanIcon,
  },
] as const;

export function ChildNav() {
  const pathname = usePathname() || "";
  const addActive = pathname === "/cocuk/plan/yeni";

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
        <li className="flex-1">
          <SideLink item={SIDE_ITEMS[0]} pathname={pathname} />
        </li>
        <li className="flex w-[4.5rem] shrink-0 items-center justify-center">
          <GuardedLink
            href="/cocuk/plan/yeni"
            aria-current={addActive ? "page" : undefined}
            aria-label="Ekle"
            className="flex min-h-12 w-12 flex-col items-center justify-center gap-0.5 rounded-full text-xs font-semibold leading-tight"
            style={{
              color: addActive ? "white" : "var(--accent)",
              background: addActive ? "var(--accent)" : "var(--accent-soft)",
              border: addActive ? "none" : "1px solid var(--accent)",
            }}
          >
            <PlusIcon />
            <span>Ekle</span>
          </GuardedLink>
        </li>
        <li className="flex-1">
          <SideLink item={SIDE_ITEMS[1]} pathname={pathname} />
        </li>
      </ul>
    </nav>
  );
}

function SideLink({
  item,
  pathname,
}: {
  item: (typeof SIDE_ITEMS)[number];
  pathname: string;
}) {
  const active = item.match(pathname);
  const Icon = item.icon;
  return (
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

function PlusIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M12 5v14M5 12h14"
        stroke="currentColor"
        strokeWidth={2.4}
        strokeLinecap="round"
      />
    </svg>
  );
}
