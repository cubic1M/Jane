import { PREMIUM_FREQUENCIES, type PremiumFrequency } from "@/config/documents";
import { isPolicyKind, type PolicyKind } from "@/config/insurance";
import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { track } from "@/lib/analytics";
import { db as defaultClient } from "@/lib/db";
import { scopedFor } from "@/lib/db-scoped";
import { readCoverage, type Coverage } from "./coverage";
import { loadHousehold } from "./household";
import { compareCover } from "./like-for-like";
import { isQuotable, partnerFor, type InsurancePartner } from "./partner";
import { POLICY_SELECT, nextRenewal, toPolicy, yearlyPremium, type Policy } from "./policies";

// Quotes for one of the person's policies (spec step 103): asked of the insurance partner
// with the policy's own cover and deductible, compared like for like, and kept until the
// next request. Getting quotes costs nothing and commits to nothing, so Jane may do it by
// herself at every autopilot level; buying always needs a tap.

type Options = { client?: PrismaClient; now?: Date; partner?: InsurancePartner | null };

export type StoredQuote = {
  id: string;
  policyId: string;
  partner: string;
  partnerQuoteId: string;
  carrier: {
    id: string;
    name: string;
    rating: string;
    ratingScore: number;
    claimsPhone: string;
    claimsUrl: string;
  };
  kind: PolicyKind;
  premiumCents: number;
  premiumFrequency: PremiumFrequency;
  annualPremiumCents: number;
  termMonths: number;
  deductibleCents: number | null;
  coverage: Coverage;
  sameCover: boolean;
  differences: string[];
  demo: boolean;
  expiresAt: Date;
  createdAt: Date;
};

export type QuotesResult =
  | { kind: "quotes"; policy: Policy; currentAnnualCents: number | null; quotes: StoredQuote[] }
  // Why there are none: no partner for this person, a kind the partner doesn't quote, or
  // not one of their policies.
  | { kind: "unavailable"; reason: "no_partner" | "not_quotable" | "not_found" };

const QUOTE_SELECT = {
  id: true,
  policyId: true,
  partner: true,
  partnerQuoteId: true,
  carrierId: true,
  carrierName: true,
  rating: true,
  ratingScore: true,
  claimsPhone: true,
  claimsUrl: true,
  kind: true,
  premiumCents: true,
  premiumFrequency: true,
  annualPremiumCents: true,
  termMonths: true,
  deductibleCents: true,
  coverage: true,
  sameCover: true,
  differences: true,
  demo: true,
  expiresAt: true,
  createdAt: true,
} as const;

type QuoteRow = Prisma.InsuranceQuoteGetPayload<{ select: typeof QUOTE_SELECT }>;

export function toStoredQuote(r: QuoteRow): StoredQuote {
  const kind = isPolicyKind(r.kind) ? r.kind : "other";
  return {
    id: r.id,
    policyId: r.policyId,
    partner: r.partner,
    partnerQuoteId: r.partnerQuoteId,
    carrier: {
      id: r.carrierId,
      name: r.carrierName,
      rating: r.rating,
      ratingScore: r.ratingScore,
      claimsPhone: r.claimsPhone,
      claimsUrl: r.claimsUrl,
    },
    kind,
    premiumCents: r.premiumCents,
    premiumFrequency: Object.hasOwn(PREMIUM_FREQUENCIES, r.premiumFrequency)
      ? (r.premiumFrequency as PremiumFrequency)
      : "yearly",
    annualPremiumCents: r.annualPremiumCents,
    termMonths: r.termMonths,
    deductibleCents: r.deductibleCents,
    coverage: readCoverage(kind, r.coverage),
    sameCover: r.sameCover,
    differences: r.differences,
    demo: r.demo,
    expiresAt: r.expiresAt,
    createdAt: r.createdAt,
  };
}

const day = (date: Date) => date.toISOString().slice(0, 10);

// When a new policy would start: the current one's next renewal, so there's no gap and no
// cancellation fee; tomorrow when there's no date.
export function startDateFor(policy: Policy, now: Date): string {
  const tomorrow = day(new Date(now.getTime() + 86_400_000));
  const renews = nextRenewal(policy, day(now));
  return renews && renews >= tomorrow ? renews : tomorrow;
}

async function activePolicy(userId: string, policyId: string, client: PrismaClient) {
  const row = await scopedFor(userId, client).insurancePolicies.findFirst({
    where: { id: policyId, status: "active" },
    select: POLICY_SELECT,
  });
  return row ? toPolicy(row) : null;
}

// Asks the partner for quotes on one policy, now, and keeps them in place of the last ones.
export async function requestQuotes(
  userId: string,
  policyId: string,
  { client = defaultClient, now = new Date(), partner }: Options = {},
): Promise<QuotesResult> {
  const policy = await activePolicy(userId, policyId, client);
  if (!policy) return { kind: "unavailable", reason: "not_found" };
  if (!isQuotable(policy.kind)) return { kind: "unavailable", reason: "not_quotable" };
  const quoting = partner === undefined ? await partnerFor(userId, { client }) : partner;
  if (!quoting) return { kind: "unavailable", reason: "no_partner" };

  // Users have their own helpers, so a direct read of the state by id.
  const [user, household] = await Promise.all([
    client.user.findUnique({ where: { id: userId }, select: { state: true } }),
    loadHousehold(userId, { client, now }),
  ]);
  const answers = await quoting.quote(
    {
      kind: policy.kind,
      state: user?.state ?? null,
      household: {
        housing: household.housing.value,
        vehicles: household.vehicles.value,
        dependants: household.dependants.value,
        pets: household.pets.value,
      },
      deductibleCents: policy.deductibleCents,
      coverage: policy.coverage,
      premiumFrequency: policy.premiumFrequency ?? "monthly",
      startDate: startDateFor(policy, now),
    },
    { now },
  );

  const db = scopedFor(userId, client);
  await db.insuranceQuotes.deleteMany({ where: { policyId } });
  if (answers.length > 0) {
    await db.insuranceQuotes.createMany({
      data: answers.map((q) => {
        const cover = compareCover(policy.kind, policy, q);
        return {
          userId,
          policyId,
          partner: quoting.name,
          partnerQuoteId: q.partnerQuoteId,
          carrierId: q.carrier.id,
          carrierName: q.carrier.name,
          rating: q.carrier.rating,
          ratingScore: q.carrier.ratingScore,
          claimsPhone: q.carrier.claimsPhone,
          claimsUrl: q.carrier.claimsUrl,
          kind: q.kind,
          premiumCents: q.premiumCents,
          premiumFrequency: q.premiumFrequency,
          annualPremiumCents: q.annualPremiumCents,
          termMonths: q.termMonths,
          deductibleCents: q.deductibleCents,
          coverage: q.coverage,
          sameCover: cover.same,
          differences: cover.differences,
          demo: q.demo,
          expiresAt: new Date(q.expiresAt),
          createdAt: now,
        };
      }),
    });
  }
  await track(userId, "insurance_quotes_requested", {
    kind: policy.kind,
    quotes: answers.length,
    partner: quoting.name,
  });
  return {
    kind: "quotes",
    policy,
    currentAnnualCents: yearlyPremium(policy),
    quotes: await quotesFor(userId, policyId, { client, now }),
  };
}

// The quotes kept for a policy that haven't expired, cheapest first.
export async function quotesFor(
  userId: string,
  policyId: string,
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<StoredQuote[]> {
  const rows = await scopedFor(userId, client).insuranceQuotes.findMany({
    where: { policyId, expiresAt: { gt: now } },
    select: QUOTE_SELECT,
    orderBy: [{ annualPremiumCents: "asc" }, { carrierName: "asc" }],
  });
  return rows.map(toStoredQuote);
}

// One kept quote by id, if it's the person's and hasn't expired.
export async function quoteById(
  userId: string,
  quoteId: string,
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<StoredQuote | null> {
  const row = await scopedFor(userId, client).insuranceQuotes.findFirst({
    where: { id: quoteId, expiresAt: { gt: now } },
    select: QUOTE_SELECT,
  });
  return row ? toStoredQuote(row) : null;
}
