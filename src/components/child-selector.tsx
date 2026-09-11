"use client";

import { useRouter } from "next/navigation";

export function ChildSelector({
  childrenOptions,
  selectedId,
}: {
  childrenOptions: Array<{ id: string; displayName: string }>;
  selectedId: string;
}) {
  const router = useRouter();
  if (childrenOptions.length <= 1) return null;

  return (
    <label className="block text-sm">
      <span className="mb-1.5 block font-semibold">Çocuk</span>
      <select
        className="min-h-11 w-full rounded-2xl border px-3"
        style={{ borderColor: "var(--line)", background: "white" }}
        value={selectedId}
        aria-label="Çocuk seç"
        onChange={async (e) => {
          const childId = e.target.value;
          await fetch("/api/parent/selected-child", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ childId }),
          });
          router.refresh();
        }}
      >
        {childrenOptions.map((c) => (
          <option key={c.id} value={c.id}>
            {c.displayName}
          </option>
        ))}
      </select>
    </label>
  );
}
