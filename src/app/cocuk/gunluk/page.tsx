import Link from "next/link";
import { redirect } from "next/navigation";
import { Button, Panel, Shell } from "@/components/ui";
import { PROMPT_OPTIONS } from "@/lib/constants";
import { listChildEntries } from "@/lib/journal";
import { getAppSession, getChildProfileForUser } from "@/lib/session";

export default async function JournalListPage() {
  const session = await getAppSession();
  if (!session || session.user.role !== "CHILD") redirect("/cocuk/giris");
  const child = await getChildProfileForUser(session.user.id);
  if (!child || child.onboardingStep !== "COMPLETE") redirect("/cocuk");

  const entries = await listChildEntries(session.user.id);

  return (
    <Shell title="Günlüğüm" subtitle="Yazdıklarını burada saklar, istediğin kadar düzenlersin.">
      <div className="space-y-4">
        <Link href="/cocuk/gunluk/yeni">
          <Button>Yeni yazı</Button>
        </Link>

        {entries.length === 0 ? (
          <Panel>
            <p className="text-sm leading-relaxed" style={{ color: "var(--muted)" }}>
              Henüz bir yazın yok. “Günümü anlat” ile başlayabilirsin.
            </p>
          </Panel>
        ) : (
          <ul className="space-y-3">
            {entries.map((entry) => {
              const promptLabel =
                PROMPT_OPTIONS.find((p) => p.key === entry.promptKey)?.label ?? "Günlük";
              const preview = entry.body.trim().slice(0, 120) || "(Boş taslak)";
              return (
                <li key={entry.id}>
                  <Link
                    href={`/cocuk/gunluk/${entry.id}`}
                    className="block rounded-2xl border p-4"
                    style={{ borderColor: "var(--line)", background: "var(--surface)" }}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <p className="font-semibold">{promptLabel}</p>
                      <p className="text-xs" style={{ color: "var(--muted)" }}>
                        {entry.diaryDate}
                      </p>
                    </div>
                    <p className="mt-2 text-sm leading-relaxed" style={{ color: "var(--muted)" }}>
                      {preview}
                      {entry.body.trim().length > 120 ? "…" : ""}
                    </p>
                    {entry.published ? (
                      <p className="mt-2 text-xs font-semibold" style={{ color: "var(--accent)" }}>
                        Paylaşılıyor
                        {entry.published.hasUnpublishedChanges ? " · güncelleme bekliyor" : ""}
                      </p>
                    ) : (
                      <p className="mt-2 text-xs" style={{ color: "var(--muted)" }}>
                        Özel
                      </p>
                    )}
                  </Link>
                </li>
              );
            })}
          </ul>
        )}

        <Link href="/cocuk/ana" className="inline-flex min-h-12 items-center font-semibold underline">
          Ana ekrana dön
        </Link>
      </div>
    </Shell>
  );
}
