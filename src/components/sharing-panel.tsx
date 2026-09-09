"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { ChildEntryView } from "@/lib/journal";
import { Button, FieldError } from "@/components/ui";

export function SharingPanel({ entry: initial }: { entry: ChildEntryView }) {
  const router = useRouter();
  const [parentMessage, setParentMessage] = useState(initial.draft.parentMessage);
  const [supportRequest, setSupportRequest] = useState(initial.draft.supportRequest);
  const [draftRevision, setDraftRevision] = useState(initial.draft.revision);
  const [published, setPublished] = useState(initial.published);
  const [message, setMessage] = useState<string | undefined>();
  const [error, setError] = useState<string | undefined>();
  const [pending, setPending] = useState(false);

  async function patch(op: string, extra: Record<string, unknown> = {}) {
    setPending(true);
    setError(undefined);
    setMessage(undefined);
    try {
      const res = await fetch(`/api/child/journal/${initial.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ op, ...extra }),
      });
      const data = (await res.json()) as {
        entry?: ChildEntryView;
        error?: string;
      };
      if (!res.ok || !data.entry) {
        setError(data.error || "İşlem başarısız.");
        setPending(false);
        return null;
      }
      setParentMessage(data.entry.draft.parentMessage);
      setSupportRequest(data.entry.draft.supportRequest);
      setDraftRevision(data.entry.draft.revision);
      setPublished(data.entry.published);
      setPending(false);
      router.refresh();
      return data.entry;
    } catch {
      setError("Bağlantı hatası. Metinler formda duruyor.");
      setPending(false);
      return null;
    }
  }

  async function saveDraft() {
    const entry = await patch("update_draft", {
      parentMessage,
      supportRequest,
      expectedRevision: draftRevision,
    });
    if (entry) setMessage("Taslak kaydedildi. Henüz paylaşılmadı.");
  }

  async function publish() {
    // Save draft first so publish uses latest text
    const saved = await patch("update_draft", {
      parentMessage,
      supportRequest,
      expectedRevision: draftRevision,
    });
    if (!saved) return;
    const entry = await patch("publish", {
      expectedDraftRevision: saved.draft.revision,
    });
    if (entry) {
      setMessage(
        published ? "Paylaşım güncellendi." : "Velinle paylaşıldı.",
      );
    }
  }

  async function withdraw() {
    const entry = await patch("withdraw");
    if (entry) {
      setMessage(
        "Paylaşım geri çekildi. Uygulamada velin artık göremez; daha önce okuduysa onu geri alamayız.",
      );
    }
  }

  function copyFromJournal() {
    setParentMessage(initial.body);
    setMessage("Yazından kopyalandı. İstersen düzenleyebilirsin.");
  }

  const previewMessage = parentMessage.trim();
  const previewSupport = supportRequest.trim();

  return (
    <div className="space-y-5">
      <section className="space-y-2">
        <h2 className="text-lg font-semibold">Bende kalacak</h2>
        <p
          className="whitespace-pre-wrap rounded-2xl border p-4 text-sm leading-relaxed"
          style={{ borderColor: "var(--line)", background: "rgba(255,255,255,0.6)", color: "var(--muted)" }}
        >
          {initial.body.trim() || "(Henüz özel yazı yok)"}
        </p>
      </section>

      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-semibold">Velimin göreceği</h2>
          <button
            type="button"
            onClick={copyFromJournal}
            className="text-sm font-semibold underline"
            style={{ color: "var(--accent)" }}
          >
            Yazımdan kopyala
          </button>
        </div>
        <label className="block" htmlFor="parent-message">
          <span className="mb-1.5 block text-sm font-semibold">Veli mesajı (isteğe bağlı)</span>
          <textarea
            id="parent-message"
            value={parentMessage}
            onChange={(e) => setParentMessage(e.target.value)}
            rows={5}
            maxLength={4000}
            className="w-full rounded-2xl border p-3 text-base"
            style={{ borderColor: "var(--line)", background: "white" }}
            placeholder="Velinin görmesini istediğin metin…"
          />
        </label>
        <label className="block" htmlFor="support-request">
          <span className="mb-1.5 block text-sm font-semibold">Destek isteği (isteğe bağlı)</span>
          <textarea
            id="support-request"
            value={supportRequest}
            onChange={(e) => setSupportRequest(e.target.value)}
            rows={3}
            maxLength={4000}
            className="w-full rounded-2xl border p-3 text-base"
            style={{ borderColor: "var(--line)", background: "white" }}
            placeholder="Velinden ne konusunda destek istersin?"
          />
        </label>
        <p className="text-sm" style={{ color: "var(--muted)" }}>
          Destek isteğini, günlük yazının tamamını paylaşmadan da gönderebilirsin.
        </p>
      </section>

      <section
        className="space-y-2 rounded-2xl p-4"
        style={{ background: "var(--accent-soft)", border: "1px solid var(--line)" }}
      >
        <h3 className="font-semibold">Önizleme</h3>
        {!previewMessage && !previewSupport ? (
          <p className="text-sm" style={{ color: "var(--muted)" }}>
            Henüz paylaşılacak bir metin yok.
          </p>
        ) : (
          <>
            {previewMessage ? (
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: "var(--muted)" }}>
                  Mesaj
                </p>
                <p className="whitespace-pre-wrap text-sm">{previewMessage}</p>
              </div>
            ) : null}
            {previewSupport ? (
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: "var(--muted)" }}>
                  Destek isteği
                </p>
                <p className="whitespace-pre-wrap text-sm">{previewSupport}</p>
              </div>
            ) : null}
          </>
        )}
      </section>

      {published?.hasUnpublishedChanges ? (
        <p className="text-sm font-semibold" style={{ color: "var(--warn)" }} role="status">
          Yayında olan içerikten farklı değişikliklerin var. Velinin görmesi için “Paylaşımı güncelle”ye bas.
        </p>
      ) : null}

      <div className="space-y-3">
        <Button type="button" variant="secondary" disabled={pending} onClick={() => void saveDraft()}>
          Taslağı kaydet
        </Button>
        <Button type="button" disabled={pending} onClick={() => void publish()}>
          {published ? "Paylaşımı güncelle" : "Paylaş"}
        </Button>
        {published ? (
          <Button type="button" variant="danger" disabled={pending} onClick={() => void withdraw()}>
            Paylaşımı geri çek
          </Button>
        ) : null}
      </div>

      <FieldError message={error} />
      {message ? (
        <p className="text-sm" style={{ color: "var(--accent)" }} role="status">
          {message}
        </p>
      ) : null}
    </div>
  );
}
