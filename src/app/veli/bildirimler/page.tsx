import { redirect } from "next/navigation";
import { NotificationBell } from "@/components/notification-bell";
import { NotificationCenter } from "@/components/notification-center";
import { Panel, Shell } from "@/components/ui";
import { getAppSession } from "@/lib/session";

export default async function ParentNotificationsPage() {
  const session = await getAppSession();
  if (!session || session.user.role !== "PARENT") redirect("/giris");

  return (
    <Shell
      title="Bildirimler"
      subtitle="Okunmamışları Yeni’de görürsün. Listeyi açmak hepsini okundu yapmaz."
      wide
      headerAction={<NotificationBell href="/veli/bildirimler" />}
    >
      <Panel>
        <NotificationCenter homeHref="/veli/ana" />
      </Panel>
    </Shell>
  );
}
