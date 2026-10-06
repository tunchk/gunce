import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Button, Panel, Shell } from "@/components/ui";
import { StudyStatusBadge } from "@/components/study-status-badge";
import { getParentCommitment, PlanError } from "@/lib/plan";
import {
  commitmentDateLabel,
  commitmentTypeLabel,
  studyStepMeta,
} from "@/lib/plan-ui";
import { calendarDateInTimeZone } from "@/lib/plan-dates";
import { getAppSession, getParentFamilyContext } from "@/lib/session";

export default async function ParentCommitmentPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await getAppSession();
  if (!session || session.user.role !== "PARENT") redirect("/giris");

  const membership = await getParentFamilyContext(session.user.id);
  if (!membership) redirect("/veli/onboarding");
  if (membership.family.onboardingStep !== "COMPLETE") redirect("/veli");

  const { id } = await params;
  let data;
  try {
    data = await getParentCommitment(session.user.id, id);
  } catch (error) {
    if (error instanceof PlanError && error.code === "NOT_FOUND") notFound();
    throw error;
  }

  const today = calendarDateInTimeZone(data.timeZone || "Europe/Istanbul");
  const c = data.commitment;

  return (
    <Shell
      title={c.title}
      subtitle={`${data.childDisplayName} · ${commitmentTypeLabel(c.type)}`}
    >
      <div className="space-y-4">
        <Panel>
          <p className="text-sm font-semibold">{commitmentTypeLabel(c.type)}</p>
          <p className="mt-2 text-sm" style={{ color: "var(--muted)" }}>
            {commitmentDateLabel(c)}
            {c.subject ? ` · ${c.subject}` : ""}
          </p>
          {c.completedAt ? (
            <p className="mt-2 text-sm" style={{ color: "var(--muted)" }}>
              Ödev olarak tamamlandı olarak işaretlenmiş.
            </p>
          ) : null}
          <p className="mt-4 text-xs leading-relaxed" style={{ color: "var(--muted)" }}>
            Bu ekran salt okunur. Düzenleme çocuğa aittir.
          </p>
        </Panel>

        {data.studySteps.length > 0 ? (
          <Panel>
            <h2 className="text-lg font-semibold">Bağlı çalışma adımları</h2>
            <ul className="mt-3 space-y-2">
              {data.studySteps.map((s) => (
                <li key={s.id}>
                  <Link
                    href={`/veli/plan/adim/${s.id}`}
                    className="block rounded-2xl border px-3 py-3"
                    style={{ borderColor: "var(--line)" }}
                  >
                    <StudyStatusBadge
                      status={s.status}
                      plannedDate={s.plannedDate}
                      today={today}
                    />
                    <p className="mt-2 font-medium">{s.title}</p>
                    <p className="text-sm" style={{ color: "var(--muted)" }}>
                      {studyStepMeta(s)}
                    </p>
                  </Link>
                </li>
              ))}
            </ul>
          </Panel>
        ) : null}

        <Link href="/veli/plan" className="block">
          <Button variant="ghost">Plana dön</Button>
        </Link>
      </div>
    </Shell>
  );
}
