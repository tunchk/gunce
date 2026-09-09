import Link from "next/link";
import { redirect } from "next/navigation";
import { NewEntryPromptPicker } from "@/components/new-entry-prompt-picker";
import { Panel, Shell } from "@/components/ui";
import { getAppSession, getChildProfileForUser } from "@/lib/session";

export default async function NewJournalPage() {
  const session = await getAppSession();
  if (!session || session.user.role !== "CHILD") redirect("/cocuk/giris");
  const child = await getChildProfileForUser(session.user.id);
  if (!child || child.onboardingStep !== "COMPLETE") redirect("/cocuk");

  return (
    <Shell title="Günümü anlat" subtitle="Bir konu seç; istediğin kadar yaz, paylaşmak zorunda değilsin.">
      <Panel>
        <NewEntryPromptPicker />
      </Panel>
      <p className="mt-4">
        <Link href="/cocuk/gunluk" className="font-semibold underline">
          Günlüğe dön
        </Link>
      </p>
    </Shell>
  );
}
