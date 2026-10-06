import Link from "next/link";
import { redirect } from "next/navigation";
import {
  ChildHelpRequestActions,
  HelpRequestStatusChip,
} from "@/components/help-child-actions";
import { Panel, Shell } from "@/components/ui";
import { getChildHelpRequest, HelpError } from "@/lib/help";
import { formatDayLabelTr } from "@/lib/plan-dates";
import { commitmentTypeLabel } from "@/lib/plan-ui";
import { getAppSession, getChildProfileForUser } from "@/lib/session";
import { notFound } from "next/navigation";

export default async function ChildHelpDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await getAppSession();
  if (!session || session.user.role !== "CHILD") redirect("/cocuk/giris");
  const child = await getChildProfileForUser(session.user.id);
  if (!child || child.onboardingStep !== "COMPLETE") redirect("/cocuk");

  const { id } = await params;
  let request;
  try {
    request = await getChildHelpRequest(session.user.id, id);
  } catch (error) {
    if (error instanceof HelpError && error.code === "NOT_FOUND") notFound();
    throw error;
  }

  const planHref =
    request.planItem.kind === "study_step"
      ? `/cocuk/plan/adim/${request.planItem.id}`
      : `/cocuk/plan/is/${request.planItem.id}`;

  const accepted =
    request.status === "ACCEPTED"
      ? request.offers.find((o) => o.id === request.acceptedOfferId)
      : undefined;

  return (
    <Shell title="Yardım isteğin" subtitle={request.planItem.title} withChildNav>
      <div className="space-y-4">
        <Panel>
          <HelpRequestStatusChip statusLabel={request.statusLabel} />
          <p className="mt-3 text-sm font-semibold">{request.helpTypeLabel}</p>
          {request.note ? (
            <p className="mt-2 text-sm leading-relaxed" style={{ color: "var(--muted)" }}>
              {request.note}
            </p>
          ) : null}
          <p className="mt-3 text-sm">
            {request.planItem.kind === "commitment" && request.planItem.type
              ? `${commitmentTypeLabel(request.planItem.type)} · `
              : ""}
            {request.planItem.title}
            {request.planItem.date
              ? ` · ${formatDayLabelTr(request.planItem.date)}`
              : ""}
          </p>
          {accepted ? (
            <p className="mt-4 rounded-2xl border p-3 text-sm leading-relaxed" style={{ borderColor: "var(--line)" }}>
              <span className="font-semibold">{accepted.guardianName}</span> ile{" "}
              {formatDayLabelTr(accepted.proposedDate)} {accepted.proposedTimeLocal}
            </p>
          ) : null}
          {request.lifecycleNotice ? (
            <p
              className="mt-4 rounded-2xl border p-3 text-sm leading-relaxed"
              style={{ borderColor: "var(--line)", background: "var(--accent-soft)" }}
              data-testid="help-lifecycle-notice"
            >
              {request.lifecycleNotice}
            </p>
          ) : null}
        </Panel>

        <Panel>
          <ChildHelpRequestActions request={request} />
        </Panel>

        <Link href={planHref} className="inline-flex min-h-12 items-center font-semibold underline">
          Plan kaydına dön
        </Link>
        <Link href="/cocuk/yardim" className="ml-4 inline-flex min-h-12 items-center font-semibold underline">
          Tüm yardımlar
        </Link>
      </div>
    </Shell>
  );
}
