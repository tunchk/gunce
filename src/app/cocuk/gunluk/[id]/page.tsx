import { notFound, redirect } from "next/navigation";
import { DeleteEntryButton } from "@/components/delete-entry-button";
import { JournalEditor } from "@/components/journal-editor";
import { GuardedLink } from "@/components/navigation-guard";
import { ChildSettingsLink, Panel, Shell } from "@/components/ui";
import { getAiFeatureStatus } from "@/lib/ai";
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
  const features = getAiFeatureStatus();

  return (
    <Shell
      title={prompt?.label ?? "Günlük yazısı"}
      subtitle="Önce anlat veya yaz. Paylaşmak ve plana eklemek isteğe bağlıdır."
      withChildNav
      headerAction={<ChildSettingsLink />}
    >
      <div className="space-y-4">
        <Panel>
          <JournalEditor
            entryId={entry.id}
            initial={entry}
            features={{
              transcriptionAvailable: features.transcriptionAvailable,
              summarizationAvailable: features.summarizationAvailable,
              planExtractAvailable: features.planExtractAvailable,
            }}
          />
        </Panel>

        <DeleteEntryButton entryId={entry.id} />

        <GuardedLink
          href="/cocuk/gunluk"
          className="inline-flex min-h-12 items-center font-semibold underline"
        >
          Günlüğe dön
        </GuardedLink>
      </div>
    </Shell>
  );
}
