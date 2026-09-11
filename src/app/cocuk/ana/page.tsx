import Link from "next/link";
import { redirect } from "next/navigation";
import { signOutAction } from "@/app/actions";
import {
  MissedStepsPanel,
  NextStudyStepPanel,
  PlanParentNotice,
} from "@/components/plan-home-panels";
import { Button, Panel, Shell } from "@/components/ui";
import { avatarEmoji } from "@/lib/constants";
import { getNextStudyStepForToday, listMissedStudySteps } from "@/lib/plan";
import { getAppSession, getChildProfileForUser } from "@/lib/session";

export default async function ChildHomePage() {
  const session = await getAppSession();
  if (!session || session.user.role !== "CHILD") redirect("/cocuk/giris");

  const child = await getChildProfileForUser(session.user.id);
  if (!child) redirect("/cocuk/giris");
  if (child.onboardingStep !== "COMPLETE") redirect("/cocuk");

  const [nextStep, missed] = await Promise.all([
    getNextStudyStepForToday(session.user.id),
    listMissedStudySteps(session.user.id),
  ]);

  return (
    <Shell title={`${avatarEmoji(child.avatarKey)} ${child.displayName}`} subtitle="Bugün nasılsın?">
      <div className="space-y-4">
        <PlanParentNotice />

        <Panel>
          <h2 className="text-xl font-semibold">Günümü anlat</h2>
          <p className="mt-2 text-sm leading-relaxed" style={{ color: "var(--muted)" }}>
            Bugününü yaz, düzenle ve istersen velinle seçtiğin kısmı paylaş.
          </p>
          <Link href="/cocuk/gunluk/yeni" className="mt-4 block">
            <Button>Günümü anlat</Button>
          </Link>
          <Link
            href="/cocuk/gunluk"
            className="mt-3 inline-flex min-h-12 items-center text-sm font-semibold underline"
          >
            Önceki yazılarım
          </Link>
        </Panel>

        <Panel>
          <NextStudyStepPanel step={nextStep} />
          <MissedStepsPanel steps={missed} />
        </Panel>

        <Panel>
          <h2 className="text-lg font-semibold">Haftama bak</h2>
          <p className="mt-2 text-sm leading-relaxed" style={{ color: "var(--muted)" }}>
            Bu haftanın ödevleri, sınavları ve çalışma adımları.
          </p>
          <Link href="/cocuk/haftam" className="mt-4 block">
            <Button variant="secondary">Haftama bak</Button>
          </Link>
          <Link href="/cocuk/plan/yeni" className="mt-3 block">
            <Button variant="ghost">Plan ekle</Button>
          </Link>
        </Panel>

        <Link
          href="/cocuk/hedefler"
          className="inline-flex min-h-12 items-center text-base font-semibold underline"
        >
          Hedeflerim
        </Link>

        <Link
          href="/cocuk/hatirlatmalar"
          className="inline-flex min-h-12 items-center text-base font-semibold underline"
        >
          Hatırlatmalar
        </Link>

        <form action={signOutAction}>
          <Button type="submit" variant="ghost">
            Çıkış yap
          </Button>
        </form>
      </div>
    </Shell>
  );
}
