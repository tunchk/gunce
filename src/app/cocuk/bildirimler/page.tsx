import { redirect } from "next/navigation";
import { NotificationBell } from "@/components/notification-bell";
import { NotificationCenter } from "@/components/notification-center";
import { ChildSettingsLink, Panel, Shell } from "@/components/ui";
import { getAppSession, getChildProfileForUser } from "@/lib/session";

export default async function ChildNotificationsPage() {
  const session = await getAppSession();
  if (!session || session.user.role !== "CHILD") redirect("/cocuk/giris");
  const child = await getChildProfileForUser(session.user.id);
  if (!child || child.onboardingStep !== "COMPLETE") redirect("/cocuk");

  return (
    <Shell
      title="Bildirimler"
      subtitle="Hatırlatmalar burada görünür. Veliler buradan mesaj yazamaz."
      withChildNav
      headerAction={
        <div className="flex items-center gap-2">
          <NotificationBell href="/cocuk/bildirimler" />
          <ChildSettingsLink />
        </div>
      }
    >
      <Panel>
        <NotificationCenter homeHref="/cocuk/ana" />
      </Panel>
    </Shell>
  );
}
