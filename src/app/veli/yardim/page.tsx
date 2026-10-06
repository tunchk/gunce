import Link from "next/link";
import { redirect } from "next/navigation";
import { Button, Panel, Shell } from "@/components/ui";
import { listParentHelpInbox } from "@/lib/help";
import { formatDayLabelTr } from "@/lib/plan-dates";
import { resolveParentChildContext } from "@/lib/parent-child-context";
import { getAppSession } from "@/lib/session";

export default async function ParentHelpInboxPage() {
  const session = await getAppSession();
  if (!session || session.user.role !== "PARENT") redirect("/giris");

  const ctx = await resolveParentChildContext(session.user.id);
  if (!ctx.child) redirect("/veli/onboarding");
  if (ctx.needsOnboarding) redirect("/veli");

  const inbox = await listParentHelpInbox(session.user.id, ctx.child.id);

  return (
    <Shell title="Yardım" subtitle={`${ctx.child.displayName} için destek istekleri.`} wide>
      <div className="space-y-4">
        <Panel>
          <h2 className="text-lg font-semibold">Yardım bekliyor</h2>
          {inbox.waiting.length === 0 ? (
            <p className="mt-3 text-sm" style={{ color: "var(--muted)" }}>
              Bekleyen yardım isteği yok.
            </p>
          ) : (
            <ul className="mt-3 space-y-3">
              {inbox.waiting.map((r) => (
                <li
                  key={r.id}
                  className="rounded-2xl border p-4"
                  style={{ borderColor: "var(--line)" }}
                >
                  <p className="text-sm font-semibold">
                    {r.childDisplayName} yardım istedi
                  </p>
                  <p className="mt-2 text-sm">{r.planItem.title}</p>
                  <p className="mt-1 text-sm" style={{ color: "var(--muted)" }}>
                    {r.helpTypeLabel}
                    {r.planItem.date ? ` · ${formatDayLabelTr(r.planItem.date)}` : ""}
                  </p>
                  {r.note ? (
                    <p className="mt-2 text-sm leading-relaxed">{r.note}</p>
                  ) : null}
                  <Link href={`/veli/yardim/${r.id}`} className="mt-3 block">
                    <Button>Yardım edebilirim</Button>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel>
          <h2 className="text-lg font-semibold">Teklif verdiklerim</h2>
          {inbox.myOffers.length === 0 ? (
            <p className="mt-3 text-sm" style={{ color: "var(--muted)" }}>
              Bekleyen teklifin yok.
            </p>
          ) : (
            <ul className="mt-3 space-y-2">
              {inbox.myOffers.map((r) => (
                <li key={r.id}>
                  <Link
                    href={`/veli/yardim/${r.id}`}
                    className="text-sm font-semibold underline"
                  >
                    {r.planItem.title} · yanıt bekleniyor
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel>
          <h2 className="text-lg font-semibold">Planlanan yardımlar</h2>
          {inbox.scheduled.length === 0 ? (
            <p className="mt-3 text-sm" style={{ color: "var(--muted)" }}>
              Planlanmış yardım yok.
            </p>
          ) : (
            <ul className="mt-3 space-y-2">
              {inbox.scheduled.map((s) => (
                <li key={s.requestId}>
                  <Link
                    href={`/veli/yardim/${s.requestId}`}
                    className="text-sm font-semibold underline"
                  >
                    {s.planItem.title} · {formatDayLabelTr(s.proposedDate)}{" "}
                    {s.proposedTimeLocal}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        {inbox.history.length > 0 ? (
          <Panel>
            <h2 className="text-lg font-semibold">Geçmiş</h2>
            <ul className="mt-3 space-y-2">
              {inbox.history.map((r) => (
                <li key={r.id} className="text-sm" style={{ color: "var(--muted)" }}>
                  {r.planItem.title} · {r.statusLabel}
                </li>
              ))}
            </ul>
          </Panel>
        ) : null}

        <Link href="/veli/ana" className="inline-flex min-h-12 items-center font-semibold underline">
          Ana sayfaya dön
        </Link>
      </div>
    </Shell>
  );
}
