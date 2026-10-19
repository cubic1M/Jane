import { notFound } from "next/navigation";
import { Suspense } from "react";
import { PLAYBOOKS } from "@/config/playbooks";
import { normalizeAlias } from "@/data-sources/merchant-directory";
import { DRAFTABLE } from "@/lib/drafts";
import { describeOutcome, outcomeFor } from "@/lib/merchant-outcomes";
import { merchantFor } from "@/lib/merchants";
import { ACTION_STATUS_LABELS } from "@/lib/action-status";
import type { DecisionCard } from "@/lib/cards";
import { getActionForAdmin, teamMembers } from "@/lib/concierge";
import { formatCents } from "@/lib/money";
import { requireAdmin } from "@/lib/session";
import { AdminNav } from "../../admin-nav";
import { db } from "@/lib/db";
import { ConversionForm } from "./conversion-form";
import { DraftPanel } from "./draft-panel";
import { StatusForm } from "./status-form";
import { savingsPhrase } from "@/lib/savings-text";
import { describePlanOptions } from "@/lib/plan-options";
import { AgentTimeline } from "@/components/agent-timeline";

async function ActionDetail({
  params,
}: {
  params: PageProps<"/admin/actions/[actionId]">["params"];
}) {
  const admin = await requireAdmin();
  const { actionId } = await params;
  const action = await getActionForAdmin(admin, actionId);
  if (!action) notFound();
  // The card exactly as the person approved it.
  const card = action.decision.cardSnapshot as unknown as DecisionCard;
  // What the person changed on Jane's plan before saying yes.
  const changes = describePlanOptions(card.actionType, action.decision.options);
  const closed = action.status === "done" || action.status === "failed";
  const playbook = PLAYBOOKS[action.type];
  const [team, replies] = await Promise.all([
    teamMembers(),
    db.savedReply.findMany({
      select: { id: true, title: true, body: true },
      orderBy: { title: "asc" },
    }),
  ]);
  // Older cards were saved before partners had their own field.
  const partnerKey = (card as Partial<DecisionCard>).referralPartner?.key ?? null;
  const partner = partnerKey
    ? await db.referralPartner.findUnique({
        where: { key: partnerKey },
        select: { name: true, referralUrl: true, active: true, revenuePerConversionCents: true },
      })
    : null;
  const merchantName = (action.decision.finding.evidence as { merchant?: unknown } | null)
    ?.merchant;
  const merchant = await merchantFor(
    typeof merchantName === "string" ? normalizeAlias(merchantName) : null,
  );
  const outcome = await outcomeFor(
    typeof merchantName === "string" ? merchantName : null,
    action.type,
  );

  return (
    <>
      <AdminNav email={admin.email} />
      <div className="flex flex-col gap-1">
        <p className="text-sm text-zinc-500">
          {action.type.replaceAll("_", " ")} · {action.user.email} · approved{" "}
          {action.decision.createdAt.toISOString().slice(0, 16).replace("T", " ")} UTC
        </p>
        <h1 className="text-2xl font-semibold tracking-tight">{card.title}</h1>
        <p className="font-medium">Status: {ACTION_STATUS_LABELS[action.status].label}</p>
      </div>

      <section className="flex flex-col gap-2 rounded-xl border border-zinc-200 p-4 dark:border-zinc-800">
        <h2 className="font-semibold">What they approved</h2>
        <p>{card.explanation}</p>
        <p>
          <strong>What changes:</strong> {card.whatChanges}
        </p>
        <p>
          <strong>Estimate:</strong>{" "}
          {card.annualSavingsCents !== null
            ? savingsPhrase(card.findingType, card.annualSavingsCents)
            : "none"}
        </p>
        <p>
          <strong>They give up:</strong> {card.giveUp}
        </p>
        {changes.length > 0 && (
          <div className="rounded-lg bg-amber-50 p-3 text-sm dark:bg-amber-950">
            <strong>They changed how to do it:</strong>
            <ul className="list-disc pl-5">
              {changes.map((c) => (
                <li key={c}>{c}</li>
              ))}
            </ul>
          </div>
        )}
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Approved from{" "}
          {
            {
              card: "the card",
              plan: "Jane's plan",
              rule: "a standing rule",
              auto: "an automatic follow-up (a charge after a cancellation they approved)",
              link: "a one-tap link in their email or a notification",
              chat: "a button in Jane's chat",
            }[action.decision.source]
          }
          .
        </p>
        {card.referralDisclosure && <p className="text-sm">{card.referralDisclosure}</p>}
        {partner && (
          <div className="flex flex-col gap-2 border-t border-zinc-200 pt-2 text-sm dark:border-zinc-800">
            <p>
              Referral partner: <strong>{partner.name}</strong>
              {!partner.active && " (now turned off)"} ·{" "}
              <a
                href={partner.referralUrl}
                target="_blank"
                rel="noreferrer"
                className="text-emerald-700 hover:underline"
              >
                Referral link
              </a>
            </p>
            <ConversionForm
              actionId={action.id}
              suggested={
                partner.revenuePerConversionCents === null
                  ? ""
                  : String(partner.revenuePerConversionCents / 100)
              }
            />
          </div>
        )}
      </section>

      {!closed && (
        <section className="flex flex-col gap-2 rounded-xl bg-emerald-50 p-4 text-sm dark:bg-emerald-950">
          <h2 className="font-semibold">Playbook</h2>
          <ol className="list-decimal space-y-1 pl-5">
            {playbook.steps.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
          <p className="font-medium">Ask the person for</p>
          <ul className="list-disc space-y-1 pl-5">
            {playbook.askFor.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
          {playbook.script && (
            <>
              <p className="font-medium">Script</p>
              <ul className="space-y-1">
                {playbook.script.map((line) => (
                  <li key={line} className="italic">
                    &ldquo;{line}&rdquo;
                  </li>
                ))}
              </ul>
            </>
          )}
          <p>
            <strong>Closing:</strong> {playbook.close}
          </p>
        </section>
      )}

      {merchant && (
        <section className="flex flex-col gap-1 rounded-xl border border-zinc-200 p-4 text-sm dark:border-zinc-800">
          <h2 className="font-semibold">{merchant.name}</h2>
          {merchant.cancelUrl && (
            <a
              href={merchant.cancelUrl}
              className="text-emerald-700 hover:underline"
              rel="noreferrer"
              target="_blank"
            >
              Cancel or manage the account
            </a>
          )}
          {merchant.supportUrl && (
            <a
              href={merchant.supportUrl}
              className="text-emerald-700 hover:underline"
              rel="noreferrer"
              target="_blank"
            >
              Support
            </a>
          )}
          {merchant.supportPhone && <p>Phone: {merchant.supportPhone}</p>}
          {outcome && <p>Past cases here: {describeOutcome(outcome)}.</p>}
          {!merchant.reviewedAt && (
            <p className="text-xs text-zinc-500">
              Not reviewed yet: check the links before using them.
            </p>
          )}
        </section>
      )}

      {!closed && DRAFTABLE[action.type] && <DraftPanel actionId={action.id} />}

      {(action.agentState || action.agentMessages.length > 0) && (
        <section className="flex flex-col gap-2 rounded-xl border border-zinc-200 p-4 dark:border-zinc-800">
          <h2 className="font-semibold">The agent</h2>
          <p className="text-sm">
            {action.agentState === "handed_off"
              ? `Handed to the team: ${action.handoffReason ?? "no reason given"}`
              : action.agentState === "finished"
                ? "Finished by the agent."
                : "The agent is working on this."}
          </p>
          <AgentTimeline messages={action.agentMessages} />
        </section>
      )}

      <section className="flex flex-col gap-2">
        <h2 className="font-semibold">Evidence</h2>
        <ul className="divide-y divide-zinc-200 rounded-xl border border-zinc-200 text-sm dark:divide-zinc-800 dark:border-zinc-800">
          {card.evidence.map((row, i) => (
            <li key={i} className="flex justify-between gap-4 px-4 py-2">
              <span className="min-w-0 break-words">
                {row.date && <span className="text-zinc-500">{row.date} · </span>}
                {row.label}
              </span>
              {row.amountCents !== null && (
                <span className="shrink-0">{formatCents(row.amountCents)}</span>
              )}
            </li>
          ))}
        </ul>
      </section>

      {closed ? (
        <section className="flex flex-col gap-1 rounded-xl bg-zinc-100 p-4 text-sm dark:bg-zinc-900">
          <p>
            Closed {action.completedAt?.toISOString().slice(0, 10)} after {action.minutesSpent}{" "}
            minutes.
          </p>
          {action.failureReason && <p>Why it failed: {action.failureReason}</p>}
          {action.notes && <p>Notes: {action.notes}</p>}
        </section>
      ) : (
        <StatusForm
          actionId={action.id}
          status={action.status}
          assignee={action.assignee}
          team={team}
          replies={replies}
          notes={action.notes}
          userTodo={action.userTodo}
        />
      )}
    </>
  );
}

export default function AdminActionPage({ params }: PageProps<"/admin/actions/[actionId]">) {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-4 py-10 sm:px-6">
      <Suspense fallback={<p className="text-zinc-500">Loading…</p>}>
        <ActionDetail params={params} />
      </Suspense>
    </main>
  );
}
