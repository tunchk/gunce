import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { SharingPanel } from "@/components/sharing-panel";
import { Panel, Shell } from "@/components/ui";
import { getChildEntry, JournalError } from "@/lib/journal";
import { getAppSession, getChildProfileForUser } from "@/lib/session";

type Props = { params: Promise<{ id: string }> };

export default async function ShareReviewPage({ params }: Props) {
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

  return (
    <Shell
      title="Ne paylaşılacak?"
      subtitle="Soldaki özel yazın sende kalır. Velinin göreceği metni ayrıca hazırlarsın."
      withChildNav
    >
      <Panel>
        <SharingPanel entry={entry} />
      </Panel>
      <p className="mt-4">
        <Link href={`/cocuk/gunluk/${entry.id}`} className="font-semibold underline">
          Yazıya dön
        </Link>
      </p>
    </Shell>
  );
}
