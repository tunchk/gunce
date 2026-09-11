import Link from "next/link";
import { redirect } from "next/navigation";
import { Button, Panel, Shell } from "@/components/ui";
import { getParentGoals } from "@/lib/goal";
import { formatLongDateTr } from "@/lib/plan-dates";
import {
  goalLifecycleLabel,
  studyStepMeta,
  studyStepStatusLabel,
} from "@/lib/plan-ui";
import { getAppSession, getParentFamilyContext } from "@/lib/session";

export default async function ParentGoalsPage() {
  const session = await getAppSession();
  if (!session || session.user.role !== "PARENT") redirect("/giris");

  const membership = await getParentFamilyContext(session.user.id);
  if (!membership) redirect("/veli/onboarding");
  if (membership.family.onboardingStep !== "COMPLETE") redirect("/veli");

  const data = await getParentGoals(session.user.id);
  const child = data.children[0];

  return (
    <Shell
      title="Hedefler"
      subtitle="Çocuğunun kaydettiği hedefler ve adımlar. Düzenleme çocuğa aittir."
      wide
    >
      <div className="space-y-4">
        {!child || child.goals.length === 0 ? (
          <Panel>
            <p className="text-sm" style={{ color: "var(--muted)" }}>
              Henüz görüntülenecek hedef yok.
            </p>
          </Panel>
        ) : (
          child.goals.map((g) => (
            <Panel key={g.id}>
              <p className="text-xs font-semibold" style={{ color: "var(--muted)" }}>
                {child.childDisplayName} · {goalLifecycleLabel(g.status)}
                {g.targetDate ? ` · ${formatLongDateTr(g.targetDate)}` : ""}
              </p>
              <h2 className="mt-1 text-lg font-semibold">{g.title}</h2>
              {g.description ? (
                <p className="mt-2 text-sm leading-relaxed" style={{ color: "var(--muted)" }}>
                  {g.description}
                </p>
              ) : null}
              {g.progress.totalCount === 0 ? (
                <p className="mt-3 text-sm" style={{ color: "var(--muted)" }}>
                  Henüz adım yok.
                </p>
              ) : (
                <div className="mt-3">
                  <p className="text-sm font-medium">{g.progress.label}</p>
                  <div
                    className="mt-2 h-2 w-full overflow-hidden rounded-full"
                    style={{ background: "var(--line)" }}
                    role="progressbar"
                    aria-valuenow={Math.round((g.progress.ratio ?? 0) * 100)}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-label={g.progress.label}
                  >
                    <div
                      className="h-full rounded-full"
                      style={{
                        width: `${Math.round((g.progress.ratio ?? 0) * 100)}%`,
                        background: "var(--accent)",
                      }}
                    />
                  </div>
                </div>
              )}
              {g.studySteps.length > 0 ? (
                <ul className="mt-4 space-y-2">
                  {g.studySteps.map((s) => (
                    <li
                      key={s.id}
                      className="rounded-2xl border px-3 py-3 text-sm"
                      style={{ borderColor: "var(--line)" }}
                    >
                      <span className="font-semibold">{studyStepStatusLabel(s.status)}</span>
                      {" · "}
                      {s.title}
                      <span className="mt-1 block" style={{ color: "var(--muted)" }}>
                        {studyStepMeta(s)}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : null}
            </Panel>
          ))
        )}
        <Link href="/veli/ana" className="block">
          <Button variant="ghost">Ana sayfaya dön</Button>
        </Link>
      </div>
    </Shell>
  );
}
