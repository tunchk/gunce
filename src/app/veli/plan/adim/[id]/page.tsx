import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Button, Panel, Shell } from "@/components/ui";
import { StudyStatusBadge } from "@/components/study-status-badge";
import { getParentStudyStep, PlanError } from "@/lib/plan";
import { studyStepMeta } from "@/lib/plan-ui";
import { calendarDateInTimeZone } from "@/lib/plan-dates";
import { getAppSession, getParentFamilyContext } from "@/lib/session";

export default async function ParentStudyStepPage({
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
    data = await getParentStudyStep(session.user.id, id);
  } catch (error) {
    if (error instanceof PlanError && error.code === "NOT_FOUND") notFound();
    throw error;
  }

  const today = calendarDateInTimeZone(data.timeZone || "Europe/Istanbul");
  const step = data.studyStep;

  return (
    <Shell
      title={step.title}
      subtitle={`${data.childDisplayName} · salt okunur çalışma adımı`}
    >
      <div className="space-y-4">
        <Panel>
          <StudyStatusBadge
            status={step.status}
            plannedDate={step.plannedDate}
            today={today}
          />
          <p className="mt-3 text-sm" style={{ color: "var(--muted)" }}>
            {studyStepMeta(step)}
          </p>
          {step.subject ? (
            <p className="mt-2 text-sm">
              <span className="font-semibold">Konu:</span> {step.subject}
            </p>
          ) : null}
          {step.relatedCommitmentTitle ? (
            <p className="mt-2 text-sm">
              <span className="font-semibold">Bağlı kayıt:</span>{" "}
              {step.relatedCommitmentTitle}
            </p>
          ) : null}
          {step.status === "DONE" ? (
            <div className="mt-4 rounded-2xl border p-3" style={{ borderColor: "var(--line)" }}>
              <p className="text-sm font-semibold">Çocuğun notu</p>
              {step.completionReflection ? (
                <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed">
                  {step.completionReflection}
                </p>
              ) : (
                <p className="mt-2 text-sm" style={{ color: "var(--muted)" }}>
                  Bu tamamlamada not yok.
                </p>
              )}
            </div>
          ) : null}
          <p className="mt-4 text-xs leading-relaxed" style={{ color: "var(--muted)" }}>
            Bu ekran salt okunur. Düzenleme çocuğa aittir.
          </p>
        </Panel>
        <Link href="/veli/plan" className="block">
          <Button variant="ghost">Plana dön</Button>
        </Link>
      </div>
    </Shell>
  );
}
