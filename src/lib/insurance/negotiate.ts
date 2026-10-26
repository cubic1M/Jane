import { conciergeMode } from "@/lib/concierge-mode";
import { PREMIUM_FREQUENCIES, type PremiumFrequency } from "@/config/documents";
import {
  NEGOTIATE_HISTORY_DAYS,
  NEGOTIATE_MIN_RISE,
  NEGOTIATIONS_DAILY_LIMIT,
} from "@/config/insurance";
import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { track } from "@/lib/analytics";
import { SYSTEM_ACTOR, logAudit } from "@/lib/audit";
import { db as defaultClient } from "@/lib/db";
import { scopedFor } from "@/lib/db-scoped";
import { parseMoneyToCents } from "@/lib/money";
import { mayAct, recordAct } from "@/lib/sector-autopilot";
import { isQuotable, partnerFor, type InsurancePartner } from "./partner";
import { listPolicies, yearlyPremium, type Policy } from "./policies";
import { quotesFor } from "./quotes";
import { listReadings } from "./readings";
import { higherCharge, policyCharges, shopPolicy } from "./shop";

// Renewal negotiation (spec step 155). Before a renewal with a price rise (a renewal notice
// Jane read, or a higher charge from the insurer), Jane asks the carrier for a better rate
// through the insurance partner, step 54's call flow, and reshops at the same time so the
// call has a like-for-like quote behind it. It calls on its own only within the person's
// Insurance autopilot limits (Everything allowed, and the monthly rise under its caps);
// otherwise it asks first. A lower price for the same cover is taken; anything that
// changes the cover is never accepted on the call, only passed on.

type Options = { client?: PrismaClient; now?: Date; partner?: InsurancePartner | null };

export class NegotiationError extends Error {}

export type Negotiation = {
  id: string;
  policyId: string;
  key: string;
  currentAnnualCents: number;
  renewalAnnualCents: number;
  competingAnnualCents: number | null;
  status: "asked" | "lowered" | "kept" | "declined";
  resultAnnualCents: number | null;
  transcript: string[];
  offer: string | null;
  calledBy: string | null;
};

const SELECT = {
  id: true,
  policyId: true,
  key: true,
  currentAnnualCents: true,
  renewalAnnualCents: true,
  competingAnnualCents: true,
  status: true,
  resultAnnualCents: true,
  transcript: true,
  offer: true,
  calledBy: true,
} as const;

function toNegotiation(
  row: Prisma.RenewalNegotiationGetPayload<{ select: typeof SELECT }>,
): Negotiation {
  return {
    ...row,
    status: row.status as Negotiation["status"],
    transcript: (Array.isArray(row.transcript) ? row.transcript : []) as string[],
  };
}

// The renewal price a policy is going to, and the key that stops it being negotiated twice:
// from a renewal notice waiting for the person's confirm (spec step 151), or from a higher
// charge from the insurer. Null when there's no rise worth a call.
export async function renewalRise(
  userId: string,
  policy: Policy,
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<{ key: string; renewalAnnualCents: number; fromAnnualCents?: number } | null> {
  const current = yearlyPremium(policy);
  if (current === null) return null;
  const notice = (await listReadings(userId, { client, status: "waiting" })).find(
    (r) => r.policyId === policy.id,
  );
  let rise: { key: string; renewalAnnualCents: number } | null = null;
  if (notice) {
    const cents = parseMoneyToCents(notice.input.premium);
    const frequency = (notice.input.premiumFrequency ||
      policy.premiumFrequency) as PremiumFrequency | null;
    if (cents !== null && frequency && Object.hasOwn(PREMIUM_FREQUENCIES, frequency)) {
      rise = {
        key: `notice:${notice.id}`,
        renewalAnnualCents: cents * PREMIUM_FREQUENCIES[frequency].perYear,
      };
    }
  }
  if (!rise && policy.premiumFrequency) {
    const charge = await higherCharge(userId, policy, { client, now });
    if (charge !== null) {
      rise = {
        key: `charge:${policy.id}:${charge}`,
        renewalAnnualCents: charge * PREMIUM_FREQUENCIES[policy.premiumFrequency].perYear,
      };
    }
  }
  if (rise) return rise.renewalAnnualCents >= current * (1 + NEGOTIATE_MIN_RISE) ? rise : null;
  // A policy found from its payments already holds the new price: the rise is its latest charge
  // against the ones before, as the suggestion to ask for a better rate reads it (gap audit).
  if (policy.premiumFrequency && policy.premiumCents !== null) {
    const [latest, ...earlier] = await policyCharges(userId, policy, {
      client,
      now,
      days: NEGOTIATE_HISTORY_DAYS,
    });
    const before = median(earlier);
    if (latest !== undefined && before > 0 && latest >= before * (1 + NEGOTIATE_MIN_RISE)) {
      const perYear = PREMIUM_FREQUENCIES[policy.premiumFrequency].perYear;
      return {
        key: `charge:${policy.id}:${latest}`,
        renewalAnnualCents: latest * perYear,
        fromAnnualCents: before * perYear,
      };
    }
  }
  return null;
}

const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0;
};

export async function listNegotiations(
  userId: string,
  { client = defaultClient, status }: Options & { status?: Negotiation["status"] } = {},
): Promise<Negotiation[]> {
  const rows = await scopedFor(userId, client).renewalNegotiations.findMany({
    where: status ? { status } : {},
    select: SELECT,
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
  return rows.map(toNegotiation);
}

// Finds each renewal with a price rise, reshops it alongside, and keeps a negotiation to ask
// about. Within the person's autopilot limits, Jane calls straight away. Returns new ones.
export async function negotiationsDue(
  userId: string,
  { client = defaultClient, now = new Date(), partner }: Options = {},
): Promise<Negotiation[]> {
  const calling = partner === undefined ? await partnerFor(userId, { client }) : partner;
  if (!calling) return [];
  // Read-only mode: nobody calls an insurer for a real account.
  if (!(await conciergeMode(userId, { client }))) return [];
  const db = scopedFor(userId, client);
  const policies = (await listPolicies(userId, { client })).filter(
    (p) => p.status === "active" && isQuotable(p.kind),
  );
  const made: Negotiation[] = [];
  for (const policy of policies) {
    const rise = await renewalRise(userId, policy, { client, now });
    if (!rise) continue;
    if (
      await db.renewalNegotiations.findFirst({ where: { key: rise.key }, select: { id: true } })
    ) {
      continue;
    }
    // The reshop alongside (spec step 104), for a like-for-like quote to put to the carrier.
    await shopPolicy(userId, policy, "price_up", `price:${policy.id}:${rise.key}`, {
      client,
      now,
      partner: calling,
    });
    const quotes = await quotesFor(userId, policy.id, { client, now });
    const same = quotes.filter((q) => q.sameCover);
    const row = await db.renewalNegotiations.create({
      data: {
        userId,
        policyId: policy.id,
        key: rise.key,
        currentAnnualCents: rise.fromAnnualCents ?? yearlyPremium(policy)!,
        renewalAnnualCents: rise.renewalAnnualCents,
        competingAnnualCents: same[0]?.annualPremiumCents ?? null,
        createdAt: now,
      },
      select: SELECT,
    });
    await track(userId, "renewal_rise_found", { kind: policy.kind });
    const negotiation = toNegotiation(row);
    // Within the person's limits: Everything allowed, and the monthly rise under the caps.
    const monthlyRise = Math.round(
      (negotiation.renewalAnnualCents - negotiation.currentAnnualCents) / 12,
    );
    const allowed = await mayAct(
      userId,
      "insurance",
      { needs: "all", cents: monthlyRise },
      { client, now },
    );
    made.push(
      allowed.ok
        ? await callCarrier(userId, negotiation.id, {
            client,
            now,
            partner: calling,
            by: "autopilot",
          })
        : negotiation,
    );
  }
  return made;
}

// The call (the person's tap, or Jane within their limits). A lower price for the same cover
// becomes the policy's price from the renewal; an offer that changes the cover is passed on.
export async function callCarrier(
  userId: string,
  negotiationId: string,
  {
    client = defaultClient,
    now = new Date(),
    partner,
    by = "you",
  }: Options & { by?: "you" | "autopilot" } = {},
): Promise<Negotiation> {
  const db = scopedFor(userId, client);
  const row = await db.renewalNegotiations.findFirst({
    where: { id: negotiationId, status: "asked" },
    select: SELECT,
  });
  if (!row) throw new NegotiationError("That one's already been answered.");
  if (!(await conciergeMode(userId, { client }))) {
    throw new NegotiationError(
      "Jane can't call for you. Call the insurer, ask them to keep last year's price, and mention the cheaper quote.",
    );
  }
  const negotiation = toNegotiation(row);
  const policy = (await listPolicies(userId, { client })).find(
    (p) => p.id === negotiation.policyId && p.status === "active",
  );
  const calling = partner === undefined ? await partnerFor(userId, { client }) : partner;
  if (!policy || !calling) throw new NegotiationError("Calling isn't available right now.");
  const result = await calling.negotiateRenewal(
    {
      carrier: policy.carrier,
      kind: policy.kind,
      currentAnnualCents: negotiation.currentAnnualCents,
      renewalAnnualCents: negotiation.renewalAnnualCents,
      competingAnnualCents: negotiation.competingAnnualCents,
    },
    { now },
  );
  const { count } = await db.renewalNegotiations.updateMany({
    where: { id: negotiationId, status: "asked" },
    data: {
      status: result.outcome,
      resultAnnualCents: result.annualPremiumCents,
      transcript: result.transcript,
      offer: result.offer,
      calledBy: by,
      calledAt: now,
    },
  });
  if (count === 0) throw new NegotiationError("That one's already been answered.");
  if (result.outcome === "lowered" && policy.premiumFrequency) {
    const perYear = PREMIUM_FREQUENCIES[policy.premiumFrequency].perYear;
    await db.insurancePolicies.updateMany({
      where: { id: policy.id },
      data: { premiumCents: Math.round(result.annualPremiumCents / perYear) },
    });
  }
  const saved = negotiation.renewalAnnualCents - result.annualPremiumCents;
  if (by === "autopilot") {
    await recordAct(
      userId,
      "insurance",
      0,
      `Asked ${policy.carrier} for a better renewal rate${saved > 0 ? " and got one" : ""}`,
      { client, now },
    );
  }
  await logAudit(
    by === "autopilot" ? SYSTEM_ACTOR : { type: "user", id: userId },
    "insurance_renewal_negotiated",
    { type: "insurance_policy", id: policy.id },
    { outcome: result.outcome, saved_cents: saved, by },
  );
  await track(userId, "renewal_negotiated", { outcome: result.outcome, saved_cents: saved, by });
  return toNegotiation(
    await db.renewalNegotiations.findFirstOrThrow({ where: { id: negotiationId }, select: SELECT }),
  );
}

// No thanks: no call.
export async function declineNegotiation(
  userId: string,
  negotiationId: string,
  { client = defaultClient }: Options = {},
): Promise<void> {
  const { count } = await scopedFor(userId, client).renewalNegotiations.updateMany({
    where: { id: negotiationId, status: "asked" },
    data: { status: "declined" },
  });
  if (count === 0) throw new NegotiationError("That one's already been answered.");
  await track(userId, "renewal_negotiation_declined");
}

// The daily run: everyone with an active policy.
export async function negotiationsAll({
  client = defaultClient,
  now = new Date(),
}: Options = {}): Promise<{ people: number; found: number }> {
  // A system job across users: ids only; everything after is scoped to the person.
  const people = await client.insurancePolicy.findMany({
    where: { status: "active" },
    select: { userId: true },
    distinct: ["userId"],
    take: NEGOTIATIONS_DAILY_LIMIT,
  });
  let found = 0;
  for (const { userId } of people) {
    try {
      found += (await negotiationsDue(userId, { client, now })).length;
    } catch (error) {
      console.error("Renewal negotiation failed", { userId, error: String(error) });
    }
  }
  return { people: people.length, found };
}
