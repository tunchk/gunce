import Link from "next/link";
import { redirect } from "next/navigation";
import { HelpRequestStatusChip } from "@/components/help-child-actions";
import { Panel, Shell } from "@/components/ui";
import { listChildHelpRequests } from "@/lib/help";
import { formatDayLabelTr } from "@/lib/plan-dates";
import { getAppSession, getChildProfileForUser } from "@/lib/session";

export default async function ChildHelpListPage() {
  const session = await getAppSession();
  if (!session || session.user.role !== "CHILD") redirect("/cocuk/giris");
  const child = await getChildProfileForUser(session.user.id);
  if (!child || child.onboardingStep !== "COMPLETE") redirect("/cocuk");

  const requests = await listChildHelpRequests(session.user.id);
  const active = requests.filter(
    (r) => r.status === "OPEN" || r.status === "OFFERED" || r.status === "ACCEPTED",
  );
  const past = requests.filter(
    (r) => r.status === "COMPLETED" || r.status === "CANCELLED",
  );

  return (
    <Shell
      title="Yardım"
      subtitle="İstediklerin ve gelen teklifler."
      withChildNav
    >
      <div className="space-y-4">
        <Panel>
          <h2 className="text-lg font-semibold">Yardım istediklerim</h2>
          {active.length === 0 ? (
            <p className="mt-3 text-sm" style={{ color: "var(--muted)" }}>
              Açık bir yardım isteğin yok. Plan kaydından isteyebilirsin.
            </p>
          ) : (
            <ul className="mt-3 space-y-3">
              {active.map((r) => (
                <li key={r.id}>
                  <Link
                    href={`/cocuk/yardim/${r.id}`}
                    className="block rounded-2xl border p-4"
                    style={{ borderColor: "var(--line)" }}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <p className="font-semibold">{r.planItem.title}</p>
                      <HelpRequestStatusChip statusLabel={r.statusLabel} />
                    </div>
                    <p className="mt-2 text-sm" style={{ color: "var(--muted)" }}>
                      {r.helpTypeLabel}
                      {r.planItem.date ? ` · ${formatDayLabelTr(r.planItem.date)}` : ""}
                    </p>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        {past.length > 0 ? (
          <Panel>
            <h2 className="text-lg font-semibold">Geçmiş</h2>
            <ul className="mt-3 space-y-2">
              {past.map((r) => (
                <li key={r.id}>
                  <Link
                    href={`/cocuk/yardim/${r.id}`}
                    className="block text-sm font-semibold underline"
                  >
                    {r.planItem.title} · {r.statusLabel}
                  </Link>
                </li>
              ))}
            </ul>
          </Panel>
        ) : null}

        <Link href="/cocuk/ana" className="inline-flex min-h-12 items-center font-semibold underline">
          Bugüne dön
        </Link>
      </div>
    </Shell>
  );
}
