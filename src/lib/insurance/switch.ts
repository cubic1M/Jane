import { MAX_DOCUMENTS, POLICY_TYPES } from "@/config/documents";
import { SWITCH_PAYMENT_DAYS } from "@/config/insurance";
import { normalizeMerchant } from "@/data-sources/merchant";
import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { sendStatusEmail } from "@/lib/action-emails";
import { handOff, loadAction, note, setStatus, type LoadedAction } from "@/lib/agent/run";
import { track } from "@/lib/analytics";
import { SYSTEM_ACTOR, logAudit } from "@/lib/audit";
import { encryptBytes } from "@/lib/crypto";
import { db as defaultClient } from "@/lib/db";
import { scopedFor } from "@/lib/db-scoped";
import { formatCents } from "@/lib/money";
import { insuranceSwitchOf } from "./accept";
import { kindWords } from "./gaps";
import { partnerFor, type InsurancePartner } from "./partner";
import { textPdf } from "./pdf";
import { POLICY_SELECT, toPolicy, yearlyPremium, type Policy } from "./policies";
import { startDateFor } from "./quotes";
import { shopById } from "./shop";

// One-tap switch (spec step 105), on step 77's machinery: after the person's Yes (spec step
// 104), Jane's agent does the rest by itself.
// 1. Binds the pick through the insurance partner, starting the day the current policy
//    renews (or tomorrow), keeps the carrier's declarations page on /documents, and adds
//    the new policy as "starting".
// 2. Each day (and after each sync) asks the partner whether its first payment went
//    through.
// 3. Only then cancels the old policy, from the new one's start day, so there's never a gap
//    in cover; the saving is counted from the two prices.
// A failed or missing payment goes to the team, with the old policy still in place.

type Options = {
  client?: PrismaClient;
  now?: Date;
  notify?: typeof sendStatusEmail;
  partner?: InsurancePartner | null;
};
type Step = Required<Pick<Options, "client" | "now" | "notify">>;

const day = (date: Date) => date.toISOString().slice(0, 10);
const dateOf = (iso: string) => new Date(`${iso}T00:00:00Z`);
const dateWords = (iso: string) =>
  dateOf(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

function addMonths(iso: string, months: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1 + months, 1));
  const last = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
  date.setUTCDate(Math.min(d, last));
  return day(date);
}

async function activePolicy(userId: string, policyId: string, client: PrismaClient) {
  const row = await scopedFor(userId, client).insurancePolicies.findFirst({
    where: { id: policyId, status: "active" },
    select: POLICY_SELECT,
  });
  return row ? toPolicy(row) : null;
}

// The carrier's documents, kept like an uploaded policy (encrypted), unless the person is
// at the document limit. Returns the document's id.
async function keepDocuments(
  userId: string,
  policy: Pick<Policy, "kind" | "carrier" | "premiumCents" | "premiumFrequency">,
  renewalDate: string,
  documents: { title: string; text: string }[],
  client: PrismaClient,
): Promise<string | null> {
  const db = scopedFor(userId, client);
  if (documents.length === 0 || (await db.documents.count()) >= MAX_DOCUMENTS) return null;
  const [declarations] = documents;
  const bytes = textPdf([declarations.title, "", ...declarations.text.split("\n")]);
  const document = await db.documents.create({
    data: {
      userId,
      kind: "insurance_policy",
      fileName: `${declarations.title}.pdf`.slice(0, 120),
      contentType: "application/pdf",
      sizeBytes: bytes.length,
      encryptedBytes: encryptBytes(bytes),
      provider: policy.carrier,
      policyType: Object.hasOwn(POLICY_TYPES, policy.kind) ? policy.kind : "other",
      premiumCents: policy.premiumCents,
      premiumFrequency: policy.premiumFrequency,
      renewalDate: dateOf(renewalDate),
      extractionSource: "partner",
    },
    select: { id: true },
  });
  await logAudit(
    SYSTEM_ACTOR,
    "document_uploaded",
    { type: "document", id: document.id },
    {
      kind: "insurance_policy",
      content_type: "application/pdf",
      size_bytes: bytes.length,
    },
  );
  return document.id;
}

// The agent's first step on an approved insurance switch: bind the pick.
export async function startInsuranceSwitch(
  userId: string,
  action: LoadedAction,
  { client = defaultClient, now = new Date(), notify = sendStatusEmail, partner }: Options = {},
): Promise<"waiting" | "handed_off"> {
  const step: Step = { client, now, notify };
  const sw = insuranceSwitchOf(action.decision.options)!;
  const [shop, old] = await Promise.all([
    shopById(userId, sw.insuranceShopId, { client }),
    activePolicy(userId, sw.insurancePolicyId, client),
  ]);
  const binding = partner === undefined ? await partnerFor(userId, { client }) : partner;
  if (!shop?.pick || !old) {
    await handOff(
      userId,
      action,
      "The policy or the quote to switch to isn't there anymore.",
      step,
    );
    return "handed_off";
  }
  if (!binding) {
    await handOff(
      userId,
      action,
      `No insurance partner can bind ${shop.pick.carrier.name} for this person; switch by hand. Keep ${old.carrier} until the new policy is paid.`,
      step,
    );
    return "handed_off";
  }
  const { pick } = shop;
  const startDate = startDateFor(old, now);
  const bound = await binding.bind(pick, { startDate, holderName: action.user.name, now });
  const renewalDate = addMonths(startDate, pick.termMonths);
  const fresh = {
    kind: pick.kind,
    carrier: pick.carrier.name,
    premiumCents: pick.premiumCents,
    premiumFrequency: pick.premiumFrequency,
  };
  const documentId = await keepDocuments(userId, fresh, renewalDate, bound.documents, client);
  const created = await scopedFor(userId, client).insurancePolicies.create({
    data: {
      userId,
      ...fresh,
      status: "pending",
      source: "switch",
      deductibleCents: pick.deductibleCents,
      coverage: pick.coverage as Prisma.InputJsonObject,
      renewalDate: dateOf(renewalDate),
      termMonths: pick.termMonths,
      documentId,
      merchantKey: normalizeMerchant(pick.carrier.name)?.key ?? null,
      policyNumber: bound.policyNumber,
      startsOn: dateOf(startDate),
      replacesPolicyId: old.id,
      actionId: action.id,
    },
    select: { id: true },
  });
  await setStatus(
    userId,
    action,
    "in_progress",
    { agentState: "switching", agentNextAt: null, userTodo: null },
    step,
  );
  await note(
    userId,
    action.id,
    `Bound ${pick.carrier.name} ${kindWords(pick.kind)}, policy ${bound.policyNumber}, starting ${dateWords(startDate)} at ${formatCents(pick.premiumCents)} a payment. ${old.carrier} stays in place until its first payment goes through; then Jane cancels it from the same day.`,
    client,
  );
  await logAudit(
    SYSTEM_ACTOR,
    "insurance_policy_bound",
    { type: "insurance_policy", id: created.id },
    {
      user_id: userId,
      action_id: action.id,
      demo: pick.demo,
    },
  );
  await track(userId, "insurance_switch_bound", { kind: pick.kind, demo: pick.demo });
  return "waiting";
}

// The daily check on every insurance switch in progress (and after a sync, for one person):
// first payment confirmed → the new policy is active and the old one is cancelled.
export async function confirmInsuranceSwitches({
  client = defaultClient,
  now = new Date(),
  notify = sendStatusEmail,
  userId: only,
  partner,
}: Options & { userId?: string } = {}): Promise<{ switched: number; handedOff: number }> {
  // A system job across users: ids only; everything after is scoped to the person.
  const pending = await client.insurancePolicy.findMany({
    where: { status: "pending", source: "switch", ...(only ? { userId: only } : {}) },
    select: { id: true, userId: true, actionId: true },
    take: 200,
  });
  const counts = { switched: 0, handedOff: 0 };
  const step: Step = { client, now, notify };
  for (const { id, userId, actionId } of pending) {
    try {
      const action = actionId ? await loadAction(userId, actionId, client) : null;
      if (!action || action.agentState !== "switching" || action.status === "done") continue;
      const db = scopedFor(userId, client);
      const row = await db.insurancePolicies.findFirst({
        where: { id },
        select: { ...POLICY_SELECT, policyNumber: true, startsOn: true, replacesPolicyId: true },
      });
      if (!row?.policyNumber || !row.startsOn) continue;
      const fresh = toPolicy(row);
      const startDate = day(row.startsOn);
      const binding = partner === undefined ? await partnerFor(userId, { client }) : partner;
      const status = binding
        ? await binding.paymentStatus(row.policyNumber, { startDate, now })
        : "failed";
      if (status === "pending") {
        const late = now.getTime() - row.startsOn.getTime() > SWITCH_PAYMENT_DAYS * 86_400_000;
        if (late) {
          await handOff(
            userId,
            action,
            `No first payment confirmed for ${fresh.carrier} ${SWITCH_PAYMENT_DAYS} days after it started. The old policy is still in place.`,
            step,
          );
          counts.handedOff += 1;
        }
        continue;
      }
      if (status === "failed") {
        await db.insurancePolicies.updateMany({ where: { id }, data: { status: "removed" } });
        await handOff(
          userId,
          action,
          `The first payment for ${fresh.carrier} didn't go through, so the old policy is still in place.`,
          step,
        );
        counts.handedOff += 1;
        continue;
      }

      // Paid: the new policy is in force. Only now is the old one cancelled, from the day
      // the new one started.
      await db.insurancePolicies.updateMany({ where: { id }, data: { status: "active" } });
      const old = row.replacesPolicyId
        ? await activePolicy(userId, row.replacesPolicyId, client)
        : null;
      let cancelled = "";
      if (old && binding) {
        const done = await binding.cancel(
          { carrier: old.carrier, policyNumber: null },
          { effectiveDate: startDate, now },
        );
        await db.insurancePolicies.updateMany({
          where: { id: old.id, status: "active" },
          data: { status: "cancelled", cancelledAt: now },
        });
        await logAudit(
          SYSTEM_ACTOR,
          "insurance_policy_cancelled",
          { type: "insurance_policy", id: old.id },
          {
            user_id: userId,
            action_id: action.id,
            effective: done.effectiveDate,
          },
        );
        cancelled = ` Cancelled ${old.carrier} from ${dateWords(done.effectiveDate)} (confirmation ${done.confirmation}), so there's no gap in cover.`;
      }
      const before = old ? yearlyPremium(old) : null;
      const after = yearlyPremium(fresh);
      const saved = before !== null && after !== null ? Math.max(0, before - after) : null;
      await setStatus(
        userId,
        action,
        "done",
        {
          agentState: "finished",
          userTodo: null,
          ...(saved !== null ? { confirmedAnnualCents: saved } : {}),
        },
        step,
      );
      await note(
        userId,
        action.id,
        `First payment to ${fresh.carrier} went through: your new policy is active.${cancelled} Done.`,
        client,
      );
      await track(userId, "insurance_switch_confirmed", { kind: fresh.kind });
      counts.switched += 1;
    } catch (error) {
      console.error("Insurance switch check failed", { policyId: id, error: String(error) });
    }
  }
  return counts;
}

// The switches in progress and finished lately, for the chat and the page.
export async function switchesFor(
  userId: string,
  { client = defaultClient, since }: { client?: PrismaClient; since: Date },
) {
  const rows = await scopedFor(userId, client).insurancePolicies.findMany({
    where: {
      source: "switch",
      // A finished switch counts as recent by its start day: it finishes on that day or
      // within SWITCH_PAYMENT_DAYS of it.
      OR: [{ status: "pending" }, { status: "active", startsOn: { gte: since } }],
    },
    select: {
      id: true,
      kind: true,
      carrier: true,
      status: true,
      startsOn: true,
      replacesPolicyId: true,
      actionId: true,
    },
    orderBy: { createdAt: "asc" },
  });
  const replaced = await scopedFor(userId, client).insurancePolicies.findMany({
    where: { id: { in: rows.flatMap((r) => (r.replacesPolicyId ? [r.replacesPolicyId] : [])) } },
    select: { id: true, carrier: true },
  });
  return rows.map((r) => ({
    policyId: r.id,
    kind: r.kind,
    carrier: r.carrier,
    status: r.status as "pending" | "active",
    startsOn: r.startsOn ? day(r.startsOn) : null,
    replaces: replaced.find((p) => p.id === r.replacesPolicyId)?.carrier ?? null,
    actionId: r.actionId,
  }));
}
