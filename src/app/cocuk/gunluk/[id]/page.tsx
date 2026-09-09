import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { DeleteEntryButton } from "@/components/delete-entry-button";
import { JournalEditor } from "@/components/journal-editor";
import { Button, Panel, Shell } from "@/components/ui";
import { PROMPT_OPTIONS } from "@/lib/constants";
import { getChildEntry, JournalError } from "@/lib/journal";
import { getAppSession, getChildProfileForUser } from "@/lib/session";

type Props = { params: Promise<{ id: string }> };

export default async function JournalEntryPage({ params }: Props) {
  const session = await getAppSession();
  if (!session || session.user.role !== "CHILD") redirect("/cocuk/giris");
  const child = await getChildProfileForUser(session.user.id);
  if (!child || child.onboardingStep !== "COMPLETE") redirect("/cocuk");

  const { id } = await params;
  let entry;
  try {
    entry = await getChildEntry(session.user.id, id);
  } catch (error) {
    if (error instanceof JournalError && error.code === "NOT_FOUND") notFound();
    throw error;
  }

  const prompt = PROMPT_OPTIONS.find((p) => p.key === entry.promptKey);

  return (
    <Shell
      title={prompt?.label ?? "Günlük yazısı"}
      subtitle={prompt?.question ?? "Düşüncelerini yaz; paylaşmak istersen sonraki adımda seçersin."}
    >
      <div className="space-y-4">
        <Panel>
          <JournalEditor entryId={entry.id} initial={entry} />
        </Panel>

        <Link href={`/cocuk/gunluk/${entry.id}/paylas`}>
          <Button variant="secondary">Paylaşımı hazırla</Button>
        </Link>

        <DeleteEntryButton entryId={entry.id} />

        <Link href="/cocuk/gunluk" className="inline-flex min-h-12 items-center font-semibold underline">
          Günlüğe dön
        </Link>
      </div>
    </Shell>
  );
}
