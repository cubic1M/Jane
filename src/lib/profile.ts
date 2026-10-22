import type { PrismaClient } from "@/generated/prisma/client";
import { roomFromPlan, tradeGoalOf } from "@/planning/goal-tradeoffs";
import { PAY_PERIODS } from "@/config/benefits";
import { PROFILE_MONTHS } from "@/config/profile";
import { db as defaultClient } from "@/lib/db";
import { scopedFor } from "@/lib/db-scoped";
import { markPrimerStale } from "@/lib/jane-agent/primer-store";
import { deletePreference, savePreference } from "@/lib/jane-agent/preferences";
import { buildProfile, type Profile, type ProfileInput, type Told } from "@/profile/build";
import { FACT_KEYS, type FactKey, factSpec } from "@/profile/facts";

// The picture of you (spec step 253), loaded for one person: what the bank shows, what they
// told Jane here and what they answered elsewhere (their tax, insurance and investor
// answers), so every sector reads one profile instead of its own guesses. A correction is
// saved as a Jane preference (kind "fact", key "profile:<fact>"), which Settings lists and
// the person can delete, and is also written to the older answer it replaces so the code
// that still reads that sees the same.

type Options = { client?: PrismaClient; now?: Date };

const PREF_PREFIX = "profile:";
const dayOf = (d: Date) => d.toISOString().slice(0, 10);
const dollars = (cents: number) => `$${Math.round(cents / 100).toLocaleString("en-US")}`;

// The raw rows a profile is built from, with what the person told Jane. Detectors (spec step
// 254) get these beside the profile, for the figures that are theirs ("you pay $1,240").
export async function loadProfileInput(
  userId: string,
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<ProfileInput> {
  const db = scopedFor(userId, client);
  const today = dayOf(now);
  const since = new Date(now.getTime() - (PROFILE_MONTHS * 31 + 2) * 86_400_000);
  const [
    transactions,
    accounts,
    liabilities,
    holdings,
    prefs,
    tax,
    insurance,
    investor,
    unread,
    reporting,
    familyCredit,
    report,
    values,
    named,
    membership,
    healthPolicy,
    fsa,
  ] = await Promise.all([
    db.transactions.findMany({
      where: { date: { gt: since, lte: now } },
      select: {
        date: true,
        amountCents: true,
        description: true,
        pfcDetailed: true,
        accountId: true,
      },
    }),
    db.accounts.findMany({
      select: {
        id: true,
        name: true,
        type: true,
        subtype: true,
        currentBalanceCents: true,
        availableBalanceCents: true,
      },
    }),
    db.liabilities.findMany({
      select: { accountId: true, kind: true, aprBps: true, hasPmi: true, payoffDate: true },
    }),
    db.holdings.findMany({
      select: {
        accountId: true,
        valueCents: true,
        costBasisCents: true,
        security: { select: { ticker: true, isCashEquivalent: true, type: true } },
      },
    }),
    db.janePreferences.findMany({
      where: { kind: "fact", OR: [{ key: { startsWith: PREF_PREFIX } }, { key: "income" }] },
      select: { key: true, value: true },
    }),
    db.taxProfiles.findFirst({
      select: {
        filingStatus: true,
        childrenUnder17: true,
        otherDependants: true,
        answered: true,
      },
    }),
    db.insuranceProfiles.findFirst({ select: { housing: true } }),
    db.investorProfiles.findFirst({ select: { age: true, ageOn: true, dropReaction: true } }),
    db.policyReadings.count({ where: { status: "waiting" } }),
    db.rentReporting.findFirst({ select: { id: true } }),
    db.familyCredit.findMany({
      select: { kind: true, balanceCents: true, monthlyPaymentCents: true, missed: true },
    }),
    db.creditReports.findFirst({
      orderBy: [{ pulledOn: "desc" }, { createdAt: "desc" }],
      select: { cardLimitCents: true },
    }),
    db.valuesPreferences.findFirst({ select: { excludes: true } }),
    db.accountBeneficiaries.findMany({ select: { accountId: true } }),
    client.householdMember.findUnique({ where: { userId }, select: { householdId: true } }),
    db.insurancePolicies.findFirst({
      where: { kind: "health", status: "active", deductibleCents: { not: null } },
      select: { carrier: true, deductibleCents: true, coverage: true },
    }),
    db.employerBenefits.findFirst({
      where: { kind: "fsa", status: { not: "declined" } },
      select: { perPayCents: true, payFrequency: true },
    }),
  ]);
  // Other people in their household in Jane (spec step 264), not counting them.
  const householdMembers = membership
    ? await client.householdMember.count({
        where: { householdId: membership.householdId, userId: { not: userId } },
      })
    : 0;

  // Answers given elsewhere come first; a correction made here wins over them.
  const told: Told = {};
  if (tax?.answered.includes("dependants")) {
    const kids = (tax.childrenUnder17 ?? 0) + (tax.otherDependants ?? 0);
    told.has_children = kids > 0;
  }
  if (tax?.filingStatus?.startsWith("married") && told.has_children !== true)
    told.household = "couple";
  if (insurance?.housing === "own" || insurance?.housing === "rent")
    told.housing = insurance.housing;
  if (investor?.age != null) {
    const years = investor.ageOn
      ? Math.floor((now.getTime() - investor.ageOn.getTime()) / (365.25 * 86_400_000))
      : 0;
    told.age = investor.age + Math.max(0, years);
  }
  if (investor?.dropReaction) told.risk = investor.dropReaction;
  // Spec step 239: "that's wrong" on an income figure is what they told Jane they earn.
  const incomeSaid = (prefs.find((p) => p.key === "income")?.value as { monthlyCents?: unknown })
    ?.monthlyCents;
  if (typeof incomeSaid === "number" && incomeSaid > 0)
    told.monthly_income = Math.round(incomeSaid);
  for (const p of prefs) {
    if (!p.key.startsWith(PREF_PREFIX)) continue;
    const key = p.key.slice(PREF_PREFIX.length);
    const value = (p.value as { value?: unknown } | null)?.value;
    if (
      (FACT_KEYS as readonly string[]).includes(key) &&
      ["string", "number", "boolean"].includes(typeof value)
    ) {
      told[key as FactKey] = value as string | number | boolean;
    }
  }

  const onlyCard = accounts.filter((a) => a.type === "credit").length === 1;
  return {
    today,
    transactions: transactions.map((t) => ({
      date: dayOf(t.date),
      amountCents: t.amountCents,
      description: t.description,
      pfc: t.pfcDetailed,
      accountId: t.accountId,
    })),
    accounts: accounts.map((a) => ({
      id: a.id,
      name: a.name,
      type: a.type,
      subtype: a.subtype,
      balanceCents: a.currentBalanceCents ?? 0,
      // A card's limit is what is owed plus what is still available.
      limitCents:
        a.type === "credit" && a.currentBalanceCents != null && a.availableBalanceCents != null
          ? a.currentBalanceCents + a.availableBalanceCents
          : // The credit report's total limit is one card's limit when there is one card.
            a.type === "credit" && onlyCard
            ? (report?.cardLimitCents ?? null)
            : null,
    })),
    holdings: holdings.map((h) => ({
      accountId: h.accountId,
      valueCents: h.valueCents,
      basisCents: h.costBasisCents,
      ticker: h.security.ticker,
      isCash: h.security.isCashEquivalent || h.security.type === "cash",
    })),
    liabilities: liabilities.map((l) => ({
      accountId: l.accountId,
      kind: l.kind,
      aprBps: l.aprBps,
      hasPmi: l.hasPmi,
      payoffDate: l.payoffDate ? dayOf(l.payoffDate) : null,
    })),
    valuesExcludes: values?.excludes ?? [],
    namedAccountIds: [...new Set(named.map((n) => n.accountId))],
    told,
    unreadPolicyDocuments: unread,
    rentReportingOn: reporting !== null,
    familyCredit: {
      helped: familyCredit.filter((f) => f.kind !== "cosigned").length,
      cosignedOwedCents: familyCredit
        .filter((f) => f.kind === "cosigned")
        .reduce((s, f) => s + (f.balanceCents ?? 0), 0),
      cosignedMissed: familyCredit.filter((f) => f.kind === "cosigned" && f.missed).length,
      cosignedPaymentCents: familyCredit
        .filter((f) => f.kind === "cosigned")
        .reduce((s, f) => s + (f.monthlyPaymentCents ?? 0), 0),
    },
    extras: { householdMembers, ...(await sectorFigures(userId, client, now)) },
    healthPlan: healthPlanOf(healthPolicy),
    fsaElectionCents: fsa
      ? fsa.perPayCents * (PAY_PERIODS[fsa.payFrequency as keyof typeof PAY_PERIODS] ?? 12)
      : null,
  };
}

// The figures the brief shares with the chat's answers, computed by the same code the chat's
// tools use (so the two cannot differ): the employer match left on the table, and the RSU
// withholding that falls short. Loaded dynamically: those reach this file again.
async function sectorFigures(userId: string, client: PrismaClient, now: Date) {
  const db = scopedFor(userId, client);
  const { loadMatchPace } = await import("@/lib/investments/match-pace");
  const hasStock =
    (await db.accounts.count({ where: { subtype: "stock plan" } })) > 0 ||
    (await db.equityEvents.count()) > 0;
  // Spec step 296: whether the practice-portfolio suggestion still applies.
  const practice = await db.practicePortfolios.count();
  const [
    matchPace,
    equity,
    subscriptions,
    cardInterest,
    shopSaving,
    policies,
    owned,
    feed,
    books,
    split,
    draft,
    goals,
    plan,
  ] = await Promise.all([
    loadMatchPace(userId, { client, now }),
    hasStock
      ? import("@/lib/equity-tax").then((m) => m.loadEquityTax(userId, { client, now }))
      : null,
    import("@/lib/jane-agent/recurring").then((m) => m.subscriptionYear(userId, { client, now })),
    import("@/lib/card-interest").then((m) => m.loadCardInterest(userId, { client, now })),
    import("@/lib/insurance/shop").then((m) => m.openShopSavingCents(userId, { client, now })),
    import("@/lib/insurance/policies").then((m) => m.listPolicies(userId, { client })),
    db.ownedAssets.findMany({ select: { valueCents: true } }),
    import("@/lib/disaster-feed").then((m) => m.disasterFeedFor(userId, { client })),
    // Spec step 238: what the daily books check left open.
    import("@/lib/books").then((m) => m.openBooks(userId, { client })),
    // Spec step 242: whether the household chose how bills split.
    client.householdMember.findUnique({
      where: { userId },
      select: { household: { select: { splitSetAt: true } } },
    }),
    import("@/lib/draft-return").then((m) => m.latestDraftCheck(userId, { client })),
    // Spec step 241: the goals, and the year plan as last kept (not worked out again here).
    import("@/lib/goals").then((m) => m.listGoals(userId, { client, now })),
    db.yearPlans.findFirst({ orderBy: { startMonth: "desc" }, select: { months: true } }),
  ]);
  const month = now.toISOString().slice(0, 7);
  const planMonths = Array.isArray(plan?.months)
    ? (plan.months as unknown as Parameters<typeof roomFromPlan>[0])
    : [];
  return {
    matchPace,
    rsuGap: equity ? equity.rsuGap : null,
    subscriptions,
    cardInterestYearCents: cardInterest.available ? cardInterest.interestYearCents : null,
    insuranceShopSavingCents: shopSaving,
    books: books.open.map((o) => ({ kind: o.kind, words: o.words, accountId: o.accountId })),
    // What they own by its value (a home, a car), for the net worth an umbrella protects.
    ownedValueCents: owned.reduce((sum, o) => sum + o.valueCents, 0),
    splitChosen: split?.household.splitSetAt != null,
    goals: goals.flatMap((g) => tradeGoalOf(g) ?? []),
    goalRoomCents: planMonths.some((m) => m.month === month)
      ? roomFromPlan(planMonths, month)[0]
      : null,
    coverPolicies: policies
      .filter((p) => p.status === "active" || p.status === "pending")
      .map((p) => ({
        id: p.id,
        kind: p.kind,
        status: p.status,
        deductibleCents: p.deductibleCents,
        coverage: p.coverage,
      })),
    // Spec step 270: the disaster relief declared where they might live (none without a feed).
    disasterRelief: feed ? await feed.declarations() : [],
    // Spec step 272: the latest checked draft return.
    draftReturn: draft,
    hasPracticePortfolio: practice > 0,
  };
}

// A health policy's terms when the plan is a coinsurance plan with a known deductible.
function healthPlanOf(
  policy: { carrier: string; deductibleCents: number | null; coverage: unknown } | null,
): ProfileInput["healthPlan"] {
  const c = (policy?.coverage ?? {}) as Record<string, unknown>;
  if (!policy || policy.deductibleCents === null || typeof c.coinsurance !== "number") return null;
  return {
    label: `${policy.carrier} plan`,
    deductibleCents: policy.deductibleCents,
    outOfPocketMaxCents: typeof c.outOfPocketMax === "number" ? c.outOfPocketMax : null,
    coinsurance: c.coinsurance,
  };
}

export async function loadProfile(userId: string, options: Options = {}): Promise<Profile> {
  return buildProfile(await loadProfileInput(userId, options));
}

export class ProfileError extends Error {}

// Checks a typed answer against the fact's kind. Throws ProfileError with a plain message.
export function parseAnswer(key: string, raw: string): string | number | boolean {
  const spec = factSpec(key);
  if (!spec || !spec.correctable) throw new ProfileError("That one can't be changed here.");
  const text = raw.trim();
  if (text === "") throw new ProfileError("Type an answer first.");
  switch (spec.kind) {
    case "boolean":
      if (/^(yes|true|y)$/i.test(text)) return true;
      if (/^(no|false|n)$/i.test(text)) return false;
      throw new ProfileError("Answer yes or no.");
    case "choice": {
      const choice = text.toLowerCase();
      if (spec.choices?.includes(choice)) return choice;
      throw new ProfileError(`Pick one of: ${spec.choices?.join(", ")}.`);
    }
    case "number":
    case "cents": {
      const n = Number(text.replace(/[$,]/g, ""));
      if (!Number.isFinite(n) || n < 0) throw new ProfileError("Type a number.");
      return spec.kind === "cents" ? Math.round(n * 100) : Math.round(n);
    }
    default:
      return text.slice(0, 120);
  }
}

const say = (key: string, value: string | number | boolean) => {
  const spec = factSpec(key)!;
  if (typeof value === "boolean") return value ? "yes" : "no";
  return spec.kind === "cents" ? dollars(Number(value)) : String(value);
};

// The person corrects a fact. It is saved as theirs (a "told" fact at 100%), and written to
// the older answer it replaces, so every reader agrees.
export async function correctFact(
  userId: string,
  key: string,
  raw: string,
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<void> {
  const value = parseAnswer(key, raw);
  const spec = factSpec(key)!;
  await savePreference(
    userId,
    {
      kind: "fact",
      key: `${PREF_PREFIX}${key}`,
      value: { value },
      label: `${spec.label}: ${say(key, value)}`,
    },
    { client },
  );
  await markPrimerStale(userId, { client });
  if (key === "housing" && (value === "own" || value === "rent")) {
    await client.insuranceProfile.upsert({
      where: { userId },
      create: { userId, housing: value },
      update: { housing: value },
    });
  }
  if (key === "age" && typeof value === "number") {
    await client.investorProfile.upsert({
      where: { userId },
      create: { userId, age: value, ageOn: now },
      update: { age: value, ageOn: now },
    });
  }
  if (key === "has_children" && typeof value === "boolean") {
    const existing = await client.taxProfile.findUnique({
      where: { userId },
      select: { childrenUnder17: true, answered: true },
    });
    const answered = [...new Set([...(existing?.answered ?? []), "dependants"])];
    const children = value ? Math.max(existing?.childrenUnder17 ?? 0, 1) : 0;
    await client.taxProfile.upsert({
      where: { userId },
      create: { userId, childrenUnder17: children, answered },
      update: { childrenUnder17: children, answered },
    });
  }
}

// Takes a correction back, so Jane goes back to what she sees.
export async function clearCorrection(
  userId: string,
  key: string,
  { client = defaultClient }: Options = {},
): Promise<boolean> {
  const row = await scopedFor(userId, client).janePreferences.findFirst({
    where: { kind: "fact", key: `${PREF_PREFIX}${key}` },
    select: { id: true },
  });
  const gone = row ? await deletePreference(userId, row.id, { client }) : false;
  if (gone) await markPrimerStale(userId, { client });
  return gone;
}

// How a fact reads aloud.
export function sayFact(key: FactKey, value: string | number | boolean | null): string {
  if (value === null) return "not known yet";
  return say(key, value);
}
