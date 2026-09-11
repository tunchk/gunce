import Link from "next/link";
import { redirect } from "next/navigation";
import { ReminderSettingsPanel } from "@/components/reminder-settings";
import { Panel, Shell } from "@/components/ui";
import { getPushAdapter, getVapidPublicKey, isWebPushConfigured } from "@/lib/push";
import { getReminderPreferences, listActivePushStatus } from "@/lib/reminder";
import { getAppSession, getChildProfileForUser } from "@/lib/session";

export default async function ChildRemindersPage() {
  const session = await getAppSession();
  if (!session || session.user.role !== "CHILD") redirect("/cocuk/giris");
  const child = await getChildProfileForUser(session.user.id);
  if (!child || child.onboardingStep !== "COMPLETE") redirect("/cocuk");

  const preferences = await getReminderPreferences(session.user.id);
  const device = await listActivePushStatus(session.user.id);

  return (
    <Shell
      title="Hatırlatmalar"
      subtitle="İsteğe bağlı günlük yazma daveti ve çalışma adımı hatırlatmaları."
      withChildNav
    >
      <div className="space-y-4">
        <Panel>
          <ReminderSettingsPanel
            initialPreferences={preferences}
            initialDevice={device}
            vapidPublicKey={isWebPushConfigured() ? getVapidPublicKey() : null}
            pushConfigured={getPushAdapter().isConfigured()}
          />
        </Panel>
        <Link href="/cocuk/ayarlar" className="inline-flex min-h-12 items-center font-semibold underline">
          Ayarlara dön
        </Link>
      </div>
    </Shell>
  );
}
