import Link from "next/link";
import { redirect } from "next/navigation";
import { Button, ChildSettingsLink, Panel, Shell } from "@/components/ui";
import { PROMPT_OPTIONS } from "@/lib/constants";
import { listChildEntries } from "@/lib/journal";
import { formatDayLabelTr } from "@/lib/plan-dates";
import { getAppSession, getChildProfileForUser } from "@/lib/session";

function sharingStateLabel(entry: {
  published: null | { hasUnpublishedChanges: boolean };
}): { text: string; tone: "private" | "shared" | "pending" } {
  if (!entry.published) {
    return { text: "Bende kalacak · özel", tone: "private" };
  }
  if (entry.published.hasUnpublishedChanges) {
    return { text: "Velin şunu görecek · güncelleme bekliyor", tone: "pending" };
  }
  return { text: "Velin şunu görecek · paylaşılıyor", tone: "shared" };
}

export default async function JournalListPage() {
  const session = await getAppSession();
  if (!session || session.user.role !== "CHILD") redirect("/cocuk/giris");
  const child = await getChildProfileForUser(session.user.id);
  if (!child || child.onboardingStep !== "COMPLETE") redirect("/cocuk");

  const entries = await listChildEntries(session.user.id);

  return (
    <Shell
      title="Günlüğüm"
      subtitle="Özel yazıların. Özet veya taslak, paylaşılmadığı sürece velin görmez."
      withChildNav
      headerAction={<ChildSettingsLink />}
    >
      <div className="space-y-4">
        <Link href="/cocuk/gunluk/yeni">
          <Button>Yeni yazı</Button>
        </Link>

        {entries.length === 0 ? (
          <Panel>
            <p className="text-sm leading-relaxed" style={{ color: "var(--muted)" }}>
              Henüz bir yazın yok. “Günümü anlat” ile başlayabilirsin.
            </p>
            <Link href="/cocuk/gunluk/yeni" className="mt-3 block">
              <Button variant="secondary">Günümü anlat</Button>
            </Link>
          </Panel>
        ) : (
          <ul className="space-y-3">
            {entries.map((entry) => {
              const promptLabel =
                PROMPT_OPTIONS.find((p) => p.key === entry.promptKey)?.label ?? "Günlük";
              const preview = entry.body.trim().slice(0, 120) || "(Boş taslak)";
              const share = sharingStateLabel(entry);
              return (
                <li key={entry.id}>
                  <Link
                    href={`/cocuk/gunluk/${entry.id}`}
                    className="block rounded-2xl border p-4"
                    style={{ borderColor: "var(--line)", background: "var(--surface)" }}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <p className="font-semibold">{promptLabel}</p>
                      <p className="shrink-0 text-xs" style={{ color: "var(--muted)" }}>
                        {formatDayLabelTr(entry.diaryDate)}
                      </p>
                    </div>
                    <p className="mt-2 text-sm leading-relaxed" style={{ color: "var(--muted)" }}>
                      {preview}
                      {entry.body.trim().length > 120 ? "…" : ""}
                    </p>
                    <p
                      className="mt-2 text-xs font-semibold"
                      style={{
                        color:
                          share.tone === "private"
                            ? "var(--muted)"
                            : share.tone === "pending"
                              ? "var(--warn)"
                              : "var(--accent)",
                      }}
                    >
                      {share.text}
                    </p>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </Shell>
  );
}
