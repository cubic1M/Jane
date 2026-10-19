import { BENEFIT_LABELS, ENROLLMENT_NOTICE_DAYS, PRIVATE_CHEAPER_CENTS } from "@/config/benefits";
import { QUOTABLE_KINDS } from "@/config/insurance";
import { daysBetween } from "@/detection/units";
import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { adviceMode } from "@/lib/advice-mode";
import { track } from "@/lib/analytics";
import { db as defaultClient } from "@/lib/db";
import { scopedFor } from "@/lib/db-scoped";
import { formatCents } from "@/lib/money";
import { listBenefits, openEnrollmentAtWork, yearlyCost, type Benefit } from "./benefits";
import type { Recommendation } from "./checkup";
import { POLICY_SELECT, toPolicy } from "./policies";
import { requestQuotes } from "./quotes";

// Benefits through work, compared with the same cover bought privately (spec step 150), and
// Jane's recommendation ready before the employer's open enrollment (demo advice).

type Options = { client?: PrismaClient; now?: Date };

export type BenefitComparison = {
  benefit: Benefit;
  throughWorkCents: number;
  // The cheapest private quote with the same cover; null when there's none to compare.
  privateCents: number | null;
  privateName: string | null;
  // Why it can't be compared like for like, when it can't.
  note: string | null;
};

// Like for like: quotes asked for with the benefit's own cover (its policy), and only a quote
// with the same cover counts. Health needs the plan's deductible, share and yearly most first.
export async function compareBenefits(
  userId: string,
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<BenefitComparison[]> {
  const benefits = (await listBenefits(userId, { client })).filter(
    (b) => b.status === "confirmed" && b.policyId,
  );
  const comparisons: BenefitComparison[] = [];
  for (const benefit of benefits) {
    const row = await scopedFor(userId, client).insurancePolicies.findFirst({
      where: { id: benefit.policyId!, status: "active" },
      select: POLICY_SELECT,
    });
    if (!row) continue;
    const policy = toPolicy(row);
    const base = {
      benefit,
      throughWorkCents: yearlyCost(benefit),
      privateCents: null,
      privateName: null,
    };
    if (!QUOTABLE_KINDS.includes(policy.kind) || policy.kind === "other") {
      comparisons.push({ ...base, note: "There's no private quote for this one." });
      continue;
    }
    const result = await requestQuotes(userId, policy.id, { client, now });
    if (result.kind !== "quotes") {
      comparisons.push({ ...base, note: "Private quotes aren't available yet." });
      continue;
    }
    if (policy.kind === "health") {
      comparisons.push({
        ...base,
        note: "Add your work plan's deductible, your share and the yearly most so I can compare it with marketplace plans on the same care.",
      });
      continue;
    }
    const best = result.quotes.find((q) => q.sameCover);
    comparisons.push({
      ...base,
      privateCents: best?.annualPremiumCents ?? null,
      privateName: best?.carrier.name ?? null,
      note: best ? null : "No private quote had the same cover.",
    });
  }
  return comparisons;
}

// Pure: the review's recommendations, each with its cost and the risk it changes, like the
// coverage checkup's.
export function reviewRecommendations(comparisons: BenefitComparison[]): Recommendation[] {
  return comparisons.map((c): Recommendation => {
    const name = `${BENEFIT_LABELS[c.benefit.kind].toLowerCase()} through ${c.benefit.employer}`;
    const kind =
      c.benefit.kind === "health"
        ? "health"
        : c.benefit.kind === "life"
          ? "life"
          : c.benefit.kind === "disability"
            ? "disability"
            : "other";
    if (c.privateCents === null) {
      return {
        key: "benefit_details",
        policyId: c.benefit.policyId,
        kind,
        title: `Keep your ${name}.`,
        costCents: 0,
        cost:
          c.throughWorkCents === 0
            ? "Paid by your employer"
            : `About ${formatCents(c.throughWorkCents)} a year`,
        risk: c.note ?? "Nothing to compare it with yet.",
        cents: [c.throughWorkCents],
      };
    }
    const saving = c.throughWorkCents - c.privateCents;
    if (saving >= PRIVATE_CHEAPER_CENTS) {
      return {
        key: "benefit_private",
        policyId: c.benefit.policyId,
        kind,
        title: `Consider buying ${BENEFIT_LABELS[c.benefit.kind].toLowerCase()} privately instead of your ${name}.`,
        costCents: -saving,
        cost: `Saves about ${formatCents(saving)} a year`,
        risk: `${c.privateName} quotes the same cover at ${formatCents(c.privateCents)} a year, against ${formatCents(c.throughWorkCents)} through work. A private policy also stays with you if you change jobs.`,
        cents: [saving, c.privateCents, c.throughWorkCents],
      };
    }
    return {
      key: "benefit_keep",
      policyId: c.benefit.policyId,
      kind,
      title: `Keep your ${name}.`,
      costCents: 0,
      cost: `About ${formatCents(c.throughWorkCents)} a year`,
      risk: `The same cover privately starts at ${formatCents(c.privateCents)} a year, so work is the better price. It ends if you leave the job.`,
      cents: [c.privateCents, c.throughWorkCents],
    };
  });
}

// Before the employer's open enrollment, once (by itself, from the daily run and after a
// sync): Jane's recommendation ready, as a checkup with reason "enrollment". Demo advice only.
export async function enrollmentReview(
  userId: string,
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<boolean> {
  const window = await openEnrollmentAtWork(userId, { client, now });
  const asOf = now.toISOString().slice(0, 10);
  if (!window || asOf > window.end || daysBetween(asOf, window.end) > ENROLLMENT_NOTICE_DAYS) {
    return false;
  }
  if (!(await adviceMode(userId, { client }))) return false;
  const db = scopedFor(userId, client);
  const since =
    new Date(`${window.end}T00:00:00Z`).getTime() - (ENROLLMENT_NOTICE_DAYS + 1) * 86_400_000;
  const done = await db.insuranceCheckups.findFirst({
    where: { reason: "enrollment", createdAt: { gte: new Date(since) } },
    select: { id: true },
  });
  if (done) return false;
  const comparisons = await compareBenefits(userId, { client, now });
  if (comparisons.length === 0) return false;
  await db.insuranceCheckups.create({
    data: {
      userId,
      reason: "enrollment",
      recommendations: reviewRecommendations(comparisons) as unknown as Prisma.InputJsonArray,
      createdAt: now,
    },
  });
  await track(userId, "benefits_review_ready", { benefits: comparisons.length });
  return true;
}

// "Compare with buying privately" on the benefits page: the same review, now, whatever the
// date (demo advice only). Returns whether one was made.
export async function reviewBenefitsNow(
  userId: string,
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<boolean> {
  if (!(await adviceMode(userId, { client }))) return false;
  const comparisons = await compareBenefits(userId, { client, now });
  if (comparisons.length === 0) return false;
  await scopedFor(userId, client).insuranceCheckups.create({
    data: {
      userId,
      reason: "enrollment",
      recommendations: reviewRecommendations(comparisons) as unknown as Prisma.InputJsonArray,
      createdAt: now,
    },
  });
  await track(userId, "benefits_review_ready", { benefits: comparisons.length, asked: true });
  return true;
}
