import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ParentHelpOfferForm } from "@/components/help-offer-form";
import { Panel, Shell } from "@/components/ui";
import { getParentHelpRequest, HelpError } from "@/lib/help";
import { formatDayLabelTr } from "@/lib/plan-dates";
import { commitmentTypeLabel } from "@/lib/plan-ui";
import { getAppSession, getParentFamilyContext } from "@/lib/session";

export default async function ParentHelpDetailPage({
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
  let request;
  try {
    request = await getParentHelpRequest(session.user.id, id);
  } catch (error) {
    if (error instanceof HelpError && error.code === "NOT_FOUND") notFound();
    throw error;
  }

  const accepted = request.offers.find((o) => o.id === request.acceptedOfferId);

  return (
    <Shell
      title={`${request.childDisplayName} yardım istedi`}
      subtitle={request.planItem.title}
    >
      <div className="space-y-4">
        <Panel>
          <p className="text-sm font-semibold">{request.helpTypeLabel}</p>
          <p className="mt-2 text-sm leading-relaxed">
            {request.planItem.kind === "commitment" && request.planItem.type
              ? `${commitmentTypeLabel(request.planItem.type)} · `
              : ""}
            {request.planItem.title}
            {request.planItem.date
              ? ` · ${formatDayLabelTr(request.planItem.date)}`
              : ""}
          </p>
          {request.note ? (
            <p className="mt-3 rounded-2xl border p-3 text-sm leading-relaxed" style={{ borderColor: "var(--line)" }}>
              {request.note}
            </p>
          ) : null}
          {accepted ? (
            <p className="mt-3 text-sm" style={{ color: "var(--muted)" }}>
              Planlandı: {formatDayLabelTr(accepted.proposedDate)}{" "}
              {accepted.proposedTimeLocal}
              {accepted.guardianUserId === session.user.id ? " (seninle)" : ""}
            </p>
          ) : null}
          <p className="mt-4 text-xs leading-relaxed" style={{ color: "var(--muted)" }}>
            Günlük yazısı burada görünmez. Yalnızca plan kaydı ve çocuğun yardım notu.
          </p>
        </Panel>

        <Panel>
          <ParentHelpOfferForm
            request={request}
            guardianUserId={session.user.id}
          />
        </Panel>

        <Link href="/veli/yardim" className="inline-flex min-h-12 items-center font-semibold underline">
          Yardım listesine dön
        </Link>
      </div>
    </Shell>
  );
}
