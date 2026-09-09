import { formatDiaryDate, type ParentSharedItem } from "@/lib/journal";
import { Panel } from "@/components/ui";

function SharedCard({ item, mode }: { item: ParentSharedItem; mode: "message" | "support" }) {
  const text = mode === "message" ? item.parentMessage : item.supportRequest;
  if (!text.trim()) return null;

  return (
    <article
      className="rounded-2xl border p-4"
      style={{ borderColor: "var(--line)", background: "rgba(255,255,255,0.7)" }}
    >
      <header className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <p className="font-semibold">{item.childDisplayName}</p>
        <p className="text-xs" style={{ color: "var(--muted)" }}>
          {formatDiaryDate(new Date(`${item.diaryDate}T00:00:00.000Z`), "UTC")}
        </p>
      </header>
      <p className="whitespace-pre-wrap text-sm leading-relaxed">{text}</p>
    </article>
  );
}

export function ParentSharedSections({
  messages,
  supportRequests,
}: {
  messages: ParentSharedItem[];
  supportRequests: ParentSharedItem[];
}) {
  return (
    <>
      <Panel>
        <h2 className="text-lg font-semibold">Benimle paylaştıkları</h2>
        {messages.length === 0 ? (
          <p className="mt-2 text-sm leading-relaxed" style={{ color: "var(--muted)" }}>
            Henüz seninle paylaşılmış bir mesaj yok. Çocuk paylaşana kadar burada bir şey görünmez.
          </p>
        ) : (
          <div className="mt-3 space-y-3">
            {messages.map((item) => (
              <SharedCard key={`m-${item.shareId}`} item={item} mode="message" />
            ))}
          </div>
        )}
        <p className="mt-4 text-sm" style={{ color: "var(--muted)" }}>
          Konuşma önerisi (bizim cümlemiz, çocuğun sözü değil): “Bunu biraz daha anlatmak ister misin?”
        </p>
      </Panel>

      <Panel>
        <h2 className="text-lg font-semibold">Nasıl destek olabilirim?</h2>
        {supportRequests.length === 0 ? (
          <p className="mt-2 text-sm leading-relaxed" style={{ color: "var(--muted)" }}>
            Açık bir destek isteği yok.
          </p>
        ) : (
          <div className="mt-3 space-y-3">
            {supportRequests.map((item) => (
              <SharedCard key={`s-${item.shareId}`} item={item} mode="support" />
            ))}
          </div>
        )}
      </Panel>
    </>
  );
}
