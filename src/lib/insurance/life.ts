import { PREMIUM_FREQUENCIES, type PremiumFrequency } from "@/config/documents";
import { LIFE_PAY_LOOKBACK_DAYS, type LifeQuestionKey } from "@/config/insurance";
import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { adviceMode } from "@/lib/advice-mode";
import { track } from "@/lib/analytics";
import { logAudit } from "@/lib/audit";
import { db as defaultClient } from "@/lib/db";
import { scopedFor } from "@/lib/db-scoped";
import { loadHousehold } from "./household";
import { lifeNeed, type LifeNeedInput, type NeedLine } from "./life-need";
import { nextLifeQuestion, type LifeAnswers, type LifeDecision } from "./life-underwriting";
import { partnerFor, type InsurancePartner, type QuoteCarrier } from "./partner";
import { listPolicies } from "./policies";

// Life insurance, sized and bought (spec step 153). Demo advice only. Jane works out how
// much cover the person needs and for how long, from their own accounts, shows the method,
// and gets term quotes from the insurance partner by herself. Applying (the health
// questions, one at a time, then Send), and buying the carrier's offer, each take the
// person's tap.

type Options = { client?: PrismaClient; now?: Date; partner?: InsurancePartner | null };

export class LifeError extends Error {}

export type LifeQuote = {
  partnerQuoteId: string;
  carrier: QuoteCarrier;
  premiumCents: number;
  annualPremiumCents: number;
  premiumFrequency: PremiumFrequency;
  expiresAt: string;
  demo: boolean;
};

export type LifeStatus = "sized" | "asking" | "offered" | "referred" | "bought" | "dismissed";

export type LifeApplication = {
  id: string;
  status: LifeStatus;
  amountCents: number;
  termYears: number;
  method: NeedLine[];
  termWhy: string;
  quotes: LifeQuote[];
  quoteId: string | null;
  answers: LifeAnswers;
  decision: (LifeDecision & { offerExpiresAt: string | null }) | null;
  policyId: string | null;
};

const SELECT = {
  id: true,
  status: true,
  amountCents: true,
  termYears: true,
  method: true,
  termWhy: true,
  quotes: true,
  quoteId: true,
  answers: true,
  decision: true,
  policyId: true,
} as const;

function toApplication(
  row: Prisma.LifeApplicationGetPayload<{ select: typeof SELECT }>,
): LifeApplication {
  return {
    id: row.id,
    status: row.status as LifeStatus,
    amountCents: row.amountCents,
    termYears: row.termYears,
    method: (Array.isArray(row.method) ? row.method : []) as unknown as NeedLine[],
    termWhy: row.termWhy,
    quotes: (Array.isArray(row.quotes) ? row.quotes : []) as unknown as LifeQuote[],
    quoteId: row.quoteId,
    answers: (row.answers ?? {}) as LifeAnswers,
    decision: (row.decision ?? null) as LifeApplication["decision"],
    policyId: row.policyId,
  };
}

const DAY = 86_400_000;
const day = (date: Date) => date.toISOString().slice(0, 10);

// What the calculation needs, from the person's accounts and insurance.
export async function lifeInput(
  userId: string,
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<Omit<LifeNeedInput, "dependants"> & { dependants: number | null }> {
  const db = scopedFor(userId, client);
  const since = new Date(now.getTime() - LIFE_PAY_LOOKBACK_DAYS * DAY);
  const [household, income, accounts, mortgages, policies] = await Promise.all([
    loadHousehold(userId, { client, now }),
    db.transactions.aggregate({
      where: { pfcDetailed: "INCOME_SALARY", pending: false, date: { gte: since, lte: now } },
      _sum: { amountCents: true },
    }),
    db.accounts.findMany({
      select: { type: true, subtype: true, currentBalanceCents: true },
    }),
    db.liabilities.findMany({ where: { kind: "mortgage" }, select: { payoffDate: true } }),
    listPolicies(userId, { client }),
  ]);
  // Plaid's sign: money in is negative.
  const paid = -(income._sum.amountCents ?? 0);
  const balance = (filter: (a: (typeof accounts)[number]) => boolean) =>
    accounts.filter(filter).reduce((sum, a) => sum + Math.max(0, a.currentBalanceCents ?? 0), 0);
  const payoff = mortgages
    .map((m) => m.payoffDate)
    .filter((d): d is Date => d !== null)
    .sort((a, b) => b.getTime() - a.getTime())[0];
  return {
    yearlyPayCents: paid > 0 ? Math.round((paid * 365) / LIFE_PAY_LOOKBACK_DAYS) : null,
    dependants: household.dependants.value,
    mortgageCents: balance((a) => a.type === "loan" && a.subtype === "mortgage"),
    otherDebtCents: balance(
      (a) => (a.type === "loan" && a.subtype !== "mortgage") || a.type === "credit",
    ),
    mortgageYearsLeft: payoff
      ? Math.max(0, Math.ceil((payoff.getTime() - now.getTime()) / (365.25 * DAY)))
      : null,
    savingsCents: balance((a) => a.type === "depository"),
    existingCoverCents: policies
      .filter((p) => p.kind === "life" && p.status === "active")
      .reduce((sum, p) => sum + Number(p.coverage.deathBenefit ?? 0), 0),
  };
}

export async function latestLife(
  userId: string,
  { client = defaultClient }: Options = {},
): Promise<LifeApplication | null> {
  const row = await scopedFor(userId, client).lifeApplications.findFirst({
    where: { status: { not: "dismissed" } },
    select: SELECT,
    orderBy: { createdAt: "desc" },
  });
  return row ? toApplication(row) : null;
}

export type SizeResult =
  | { kind: "sized"; application: LifeApplication }
  // Mid-application, or already decided: left as it is.
  | { kind: "in_progress"; application: LifeApplication }
  | { kind: "no_advice" }
  | { kind: "ask_dependants" }
  | { kind: "not_needed"; reason: "no_dependants" | "no_pay" | "covered" };

// Works out the cover and gets term quotes, keeping one application to answer. Re-sized
// when the numbers move; one being applied for is left alone.
export async function sizeLife(
  userId: string,
  { client = defaultClient, now = new Date(), partner }: Options = {},
): Promise<SizeResult> {
  if (!(await adviceMode(userId, { client }))) return { kind: "no_advice" };
  const current = await latestLife(userId, { client });
  if (current && current.status !== "sized") return { kind: "in_progress", application: current };
  const input = await lifeInput(userId, { client, now });
  if (input.dependants === null) return { kind: "ask_dependants" };
  if (input.dependants === 0) return { kind: "not_needed", reason: "no_dependants" };
  if (!input.yearlyPayCents) return { kind: "not_needed", reason: "no_pay" };
  const need = lifeNeed({ ...input, dependants: input.dependants });
  if (!need) return { kind: "not_needed", reason: "covered" };

  const db = scopedFor(userId, client);
  if (
    current &&
    current.amountCents === need.amountCents &&
    current.termYears === need.termYears &&
    current.quotes.some((q) => q.expiresAt > now.toISOString())
  ) {
    return { kind: "sized", application: current };
  }
  const quoting = partner === undefined ? await partnerFor(userId, { client }) : partner;
  const answers = quoting
    ? await quoting.quote(
        {
          kind: "life",
          state: null,
          household: { housing: null, vehicles: null, dependants: input.dependants, pets: null },
          deductibleCents: null,
          coverage: { deathBenefit: need.amountCents, termYears: need.termYears },
          premiumFrequency: "monthly",
          startDate: day(new Date(now.getTime() + DAY)),
        },
        { now },
      )
    : [];
  const quotes: LifeQuote[] = answers.map((q) => ({
    partnerQuoteId: q.partnerQuoteId,
    carrier: q.carrier,
    premiumCents: q.premiumCents,
    annualPremiumCents: q.annualPremiumCents,
    premiumFrequency: q.premiumFrequency,
    expiresAt: q.expiresAt,
    demo: q.demo,
  }));
  const data = {
    amountCents: need.amountCents,
    termYears: need.termYears,
    method: need.lines as unknown as Prisma.InputJsonArray,
    termWhy: need.termWhy,
    quotes: quotes as unknown as Prisma.InputJsonArray,
  };
  const row = current
    ? (await db.lifeApplications.updateMany({ where: { id: current.id, status: "sized" }, data }),
      await db.lifeApplications.findFirstOrThrow({ where: { id: current.id }, select: SELECT }))
    : await db.lifeApplications.create({ data: { userId, ...data }, select: SELECT });
  await track(userId, "life_sized", { amount_cents: need.amountCents, quotes: quotes.length });
  return { kind: "sized", application: toApplication(row) };
}

// "Does anyone depend on your income?": kept on the household, for the calculation.
export async function saveDependants(
  userId: string,
  dependants: number,
  { client = defaultClient }: Options = {},
): Promise<void> {
  await scopedFor(userId, client).insuranceProfiles.upsert({
    where: { userId },
    create: { userId, dependants },
    update: { dependants },
  });
  await track(userId, "insurance_household_saved", { from: "life" });
}

async function load(userId: string, id: string, client: PrismaClient, status: LifeStatus[]) {
  const row = await scopedFor(userId, client).lifeApplications.findFirst({
    where: { id, status: { in: status } },
    select: SELECT,
  });
  if (!row) throw new LifeError("That one's already been answered.");
  return toApplication(row);
}

async function save(
  userId: string,
  id: string,
  from: LifeStatus[],
  data: Prisma.LifeApplicationUpdateManyMutationInput,
  client: PrismaClient,
) {
  const db = scopedFor(userId, client);
  const { count } = await db.lifeApplications.updateMany({
    where: { id, status: { in: from } },
    data,
  });
  if (count === 0) throw new LifeError("That one's already been answered.");
  return toApplication(
    await db.lifeApplications.findFirstOrThrow({ where: { id }, select: SELECT }),
  );
}

// Apply (a tap): on the quote they picked, starting the health questions.
export async function startLifeApplication(
  userId: string,
  id: string,
  partnerQuoteId: string | null,
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<LifeApplication> {
  const application = await load(userId, id, client, ["sized"]);
  const live = application.quotes.filter((q) => q.expiresAt > now.toISOString());
  const quote = partnerQuoteId ? live.find((q) => q.partnerQuoteId === partnerQuoteId) : live[0];
  if (!quote) throw new LifeError("Those quotes have expired. I'll get fresh ones.");
  const started = await save(
    userId,
    id,
    ["sized"],
    { status: "asking", quoteId: quote.partnerQuoteId, answers: {} },
    client,
  );
  await track(userId, "life_application_started", { carrier: quote.carrier.id });
  return started;
}

// One health answer. Returns the application with the next question still to ask.
export async function answerLifeQuestion(
  userId: string,
  id: string,
  key: LifeQuestionKey,
  yes: boolean,
  { client = defaultClient }: Options = {},
): Promise<LifeApplication> {
  const application = await load(userId, id, client, ["asking"]);
  if (nextLifeQuestion(application.answers) !== key) {
    throw new LifeError("That one's already been answered.");
  }
  return save(
    userId,
    id,
    ["asking"],
    { answers: { ...application.answers, [key]: yes } as Prisma.InputJsonObject },
    client,
  );
}

const quoteOf = (application: LifeApplication) =>
  application.quotes.find((q) => q.partnerQuoteId === application.quoteId) ?? null;

// Send (a tap, once every question is answered): the carrier decides through the partner.
export async function submitLifeApplication(
  userId: string,
  id: string,
  { client = defaultClient, now = new Date(), partner }: Options = {},
): Promise<LifeApplication> {
  const application = await load(userId, id, client, ["asking"]);
  if (nextLifeQuestion(application.answers) !== null) {
    throw new LifeError("There are still questions to answer.");
  }
  const quote = quoteOf(application);
  const applying = partner === undefined ? await partnerFor(userId, { client }) : partner;
  if (!quote || !applying) throw new LifeError("Applying isn't available right now.");
  const decision = await applying.applyLife({ quote, answers: application.answers }, { now });
  const sent = await save(
    userId,
    id,
    ["asking"],
    {
      status: decision.outcome,
      decision: decision as unknown as Prisma.InputJsonObject,
      submittedAt: now,
    },
    client,
  );
  // Health answers are never logged; only that an application went in, and the outcome.
  await logAudit(
    { type: "user", id: userId },
    "life_application_submitted",
    { type: "life_application", id },
    { carrier: quote.carrier.id, outcome: decision.outcome },
  );
  await track(userId, "life_application_submitted", { outcome: decision.outcome });
  return sent;
}

// Buy (a tap): the carrier's offer becomes a policy on the person's insurance.
export async function buyLife(
  userId: string,
  id: string,
  { client = defaultClient, now = new Date(), partner }: Options = {},
): Promise<string> {
  const application = await load(userId, id, client, ["offered"]);
  const decision = application.decision;
  const quote = quoteOf(application);
  if (!decision || decision.outcome !== "offered" || !quote) {
    throw new LifeError("There's no offer to accept.");
  }
  if (decision.offerExpiresAt && decision.offerExpiresAt <= now.toISOString()) {
    throw new LifeError("That offer has expired. Apply again for a fresh one.");
  }
  const binding = partner === undefined ? await partnerFor(userId, { client }) : partner;
  if (!binding) throw new LifeError("Buying isn't available right now.");
  const startDate = day(new Date(now.getTime() + DAY));
  const coverage = { deathBenefit: application.amountCents, termYears: application.termYears };
  const user = await client.user.findUnique({ where: { id: userId }, select: { name: true } });
  const bound = await binding.bind(
    {
      partnerQuoteId: quote.partnerQuoteId,
      carrier: quote.carrier,
      kind: "life",
      premiumCents: decision.premiumCents,
      deductibleCents: null,
      coverage,
      termMonths: 12,
    },
    { startDate, holderName: user?.name ?? null, now },
  );
  const db = scopedFor(userId, client);
  const policy = await db.insurancePolicies.create({
    data: {
      userId,
      kind: "life",
      carrier: bound.carrier.name,
      status: "active",
      source: "switch",
      premiumCents: decision.premiumCents,
      premiumFrequency: quote.premiumFrequency,
      renewalDate: new Date(`${day(new Date(now.getTime() + 366 * DAY))}T00:00:00Z`),
      termMonths: 12,
      coverage,
      covers: `${application.termYears}-year term life, policy ${bound.policyNumber}`,
    },
    select: { id: true },
  });
  await save(userId, id, ["offered"], { status: "bought", policyId: policy.id }, client);
  await logAudit(
    { type: "user", id: userId },
    "insurance_policy_saved",
    { type: "insurance_policy", id: policy.id },
    { kind: "life", from: "life_application" },
  );
  await track(userId, "life_bought", {
    carrier: quote.carrier.id,
    annual_cents: decision.annualPremiumCents,
    per_year: PREMIUM_FREQUENCIES[quote.premiumFrequency].perYear,
  });
  return policy.id;
}

// No thanks: nothing is applied for or bought.
export async function dismissLife(
  userId: string,
  id: string,
  { client = defaultClient }: Options = {},
): Promise<void> {
  await save(
    userId,
    id,
    ["sized", "asking", "offered", "referred"],
    { status: "dismissed" },
    client,
  );
  await track(userId, "life_dismissed");
}
