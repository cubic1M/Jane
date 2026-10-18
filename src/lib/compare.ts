import { BILL_BENCHMARKS } from "@/config/detection";
import { OPTION_STALE_DAYS } from "@/config/compare";
import { DEMO_OPTIONS } from "@/data-sources/demo/demo-options";
import {
  findInDirectory,
  normalizeAlias,
  type DirectoryMerchant,
} from "@/data-sources/merchant-directory";
import type { FindingType, PrismaClient } from "@/generated/prisma/client";
import { db as defaultClient } from "@/lib/db";
import { hasDemoBank } from "@/lib/plaid/demo";
import {
  compareOptions,
  type CompareOption,
  type Comparison,
  type Current,
} from "@/planning/compare";

// Loads the options Jane may compare and works out the comparison for a finding (spec
// step 76). Only options the team reviewed are compared; the demo examples only for people
// using the demo bank, and only where the demo bank is offered.

type Options = { client?: PrismaClient; now?: Date };
type CompareFor = Options & { userId: string };

const DAY_MS = 24 * 60 * 60 * 1000;

export function demoOptionsAllowed(): boolean {
  return process.env.DEMO_BANK === "1" || process.env.NODE_ENV !== "production";
}

export async function usableOptions({
  client = defaultClient,
  now = new Date(),
  includeDemo = false,
}: Options & { includeDemo?: boolean } = {}): Promise<CompareOption[]> {
  const rows = await client.switchOption.findMany({
    where: {
      checkedAt: { gte: new Date(now.getTime() - OPTION_STALE_DAYS * DAY_MS) },
      OR: [
        { reviewedAt: { not: null }, demo: false },
        ...(includeDemo && demoOptionsAllowed() ? [{ demo: true }] : []),
      ],
    },
    orderBy: { id: "asc" },
  });
  return rows.map((r) => ({
    id: r.id,
    kind: r.kind as CompareOption["kind"],
    category: r.category,
    merchantKey: r.merchantKey,
    provider: r.provider,
    name: r.name,
    monthlyCents: r.monthlyCents,
    apyBps: r.apyBps,
    contractMonths: r.contractMonths,
    oneTimeFeeCents: r.oneTimeFeeCents,
    minimumBalanceCents: r.minimumBalanceCents,
    includes: r.includes,
    givesUp: r.givesUp,
    signUpUrl: r.signUpUrl,
    sourceUrl: r.sourceUrl,
    checkedAt: r.checkedAt.toISOString().slice(0, 10),
    demo: r.demo,
  }));
}

// Puts the demo examples in place (checked today), for the demo bank's syncs.
export async function ensureDemoOptions({
  client = defaultClient,
  now = new Date(),
}: Options = {}) {
  if (!demoOptionsAllowed()) return;
  const checkedAt = new Date(`${now.toISOString().slice(0, 10)}T00:00:00Z`);
  await client.switchOption.createMany({
    data: DEMO_OPTIONS.map((o) => ({ ...o, demo: true, checkedAt })),
    skipDuplicates: true,
  });
  await client.switchOption.updateMany({ where: { demo: true }, data: { checkedAt } });
}

type FindingLike = { type: FindingType; evidence: unknown };

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);

// What the person has now, from a finding's evidence; null when there's nothing to compare.
export function currentFor(
  finding: FindingLike,
  directory: readonly DirectoryMerchant[],
): Current | null {
  const e = (finding.evidence ?? {}) as Record<string, unknown>;
  const merchant = typeof e.merchant === "string" ? e.merchant : null;
  const alias = merchant ? normalizeAlias(merchant) : null;
  const merchantKey = alias ? (findInDirectory(alias, directory)?.key ?? alias) : null;
  if (finding.type === "bill_negotiation") {
    const monthlyCents = num(e.monthlyCents);
    const benchmark = BILL_BENCHMARKS.find((b) => b.label === e.billKind);
    if (monthlyCents === null || !benchmark) return null;
    return { kind: "bill", monthlyCents, category: benchmark.id, merchantKey };
  }
  if (finding.type === "price_increase" || finding.type === "subscription_review") {
    const annual = num(e.annualCostCents);
    const last = num(e.lastAmountCents);
    const monthlyCents =
      e.frequency === "MONTHLY" && last !== null
        ? last
        : annual !== null
          ? Math.round(annual / 12)
          : null;
    if (monthlyCents === null || !merchantKey) return null;
    return { kind: "bill", monthlyCents, category: null, merchantKey };
  }
  if (finding.type === "idle_cash") {
    const amountCents = num(e.excessCents);
    const currentRateBps = num(e.assumedCurrentRateBps);
    if (amountCents === null || currentRateBps === null) return null;
    return { kind: "savings", amountCents, currentRateBps };
  }
  return null;
}

export async function comparisonFor(
  finding: FindingLike,
  { userId, client = defaultClient, now = new Date() }: CompareFor,
): Promise<Comparison | null> {
  const directory = await client.merchant.findMany({
    select: { key: true, name: true, aliases: true, category: true },
  });
  const current = currentFor(finding, directory);
  if (!current) return null;
  const includeDemo = await hasDemoBank(userId, { client });
  return compareOptions(current, await usableOptions({ client, now, includeDemo }));
}

// Several findings at once, for the Jane hub (spec step 80): the directory and the options
// load once, not once per finding. In the same order as `findings`.
export async function comparisonsFor(
  findings: FindingLike[],
  { userId, client = defaultClient, now = new Date() }: CompareFor,
): Promise<(Comparison | null)[]> {
  if (findings.length === 0) return [];
  const directory = await client.merchant.findMany({
    select: { key: true, name: true, aliases: true, category: true },
  });
  const currents = findings.map((f) => currentFor(f, directory));
  if (currents.every((c) => c === null)) return currents.map(() => null);
  const includeDemo = await hasDemoBank(userId, { client });
  const options = await usableOptions({ client, now, includeDemo });
  return currents.map((current) => (current ? compareOptions(current, options) : null));
}
