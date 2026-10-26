import {
  DEMO_FSA_ELECTION_CENTS,
  DEMO_HEALTH_PLAN,
  DEMO_NETWORK_DIRECTORY,
} from "@/config/insurance";
import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { track } from "@/lib/analytics";
import { db as defaultClient } from "@/lib/db";
import { scopedFor } from "@/lib/db-scoped";
import { demoHasEmployer } from "@/lib/plaid/demo";
import { formatCents } from "@/lib/money";
import { listBenefits, yearlyCost } from "./benefits";
import {
  disputes,
  fsaStatus,
  networkOf,
  planBills,
  progress,
  type Bill,
  type Dispute,
  type FsaStatus,
  type Network,
  type Plan,
  type Progress,
} from "./health-year-rules";
import { partnerFor } from "./partner";
import { listPolicies } from "./policies";
import { isoDay as asOfOf } from "@/lib/dates";

// Health cover all year (spec step 200): the person's health plan's year so far, from the
// plan's terms and their medical spending; the FSA and HSA money, the plan's network for the
// providers they've paid, and a dispute card for a big bill above the plan's share. Facts
// only. The demo bank has no health policy of its own, so its year uses a sample plan,
// said so; a real person with no health plan on file gets nothing made up.

type Options = { client?: PrismaClient; now?: Date };

export type HealthYear = {
  plan: Plan;
  // Whether the plan's terms are the demo bank's sample plan.
  sample: boolean;
  progress: Progress;
  bills: (Bill & { network: Network })[];
  fsa: FsaStatus | null;
  hsa: { name: string; balanceCents: number } | null;
  disputes: (Dispute & { network: Network })[];
};

export async function loadHealthYear(
  userId: string,
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<HealthYear | null> {
  const db = scopedFor(userId, client);
  const asOf = asOfOf(now);
  const year = asOf.slice(0, 4);
  const [policies, benefits, partner, txs, accounts] = await Promise.all([
    listPolicies(userId, { client }),
    listBenefits(userId, { client }),
    partnerFor(userId, { client }),
    db.transactions.findMany({
      where: {
        pfcDetailed: { startsWith: "MEDICAL_" },
        amountCents: { gt: 0 },
        date: {
          gte: new Date(`${Number(year) - 1}-01-01T00:00:00Z`),
          lte: new Date(`${asOf}T00:00:00Z`),
        },
      },
      select: {
        id: true,
        date: true,
        amountCents: true,
        description: true,
        merchantName: true,
        pfcDetailed: true,
      },
      orderBy: { date: "asc" },
    }),
    db.accounts.findMany({
      where: { subtype: "hsa" },
      select: { name: true, currentBalanceCents: true },
    }),
  ]);

  const real = policies.find(
    (p) =>
      p.kind === "health" &&
      p.status === "active" &&
      p.deductibleCents !== null &&
      typeof p.coverage.coinsurance === "number",
  );
  const sample = !real && partner !== null;
  const plan: Plan | null = real
    ? {
        label: `${real.carrier} plan`,
        deductibleCents: real.deductibleCents ?? 0,
        outOfPocketMaxCents:
          typeof real.coverage.outOfPocketMax === "number" ? real.coverage.outOfPocketMax : null,
        coinsurance: real.coverage.coinsurance as number,
      }
    : sample
      ? {
          label: `${DEMO_HEALTH_PLAN.name} (sample plan)`,
          deductibleCents: DEMO_HEALTH_PLAN.deductibleCents,
          outOfPocketMaxCents: DEMO_HEALTH_PLAN.outOfPocketMaxCents,
          coinsurance: DEMO_HEALTH_PLAN.coinsurance,
        }
      : null;
  if (!plan) return null;

  const everyBill: Bill[] = txs.map((t) => ({
    id: t.id,
    date: t.date.toISOString().slice(0, 10),
    provider: t.merchantName?.trim() || t.description,
    cents: t.amountCents,
    category: t.pfcDetailed,
  }));
  // The plan year is the calendar year; last year's bills are kept only to check them.
  const all = everyBill.filter((b) => b.date.startsWith(year));
  const bills = planBills(all);
  const withNetwork = (b: Bill) => ({
    ...b,
    network: partner
      ? networkOf(`${b.provider} ${b.category ?? ""}`, DEMO_NETWORK_DIRECTORY)
      : "unknown",
  });

  const fsaBenefit = benefits.find((b) => b.kind === "fsa" && b.status !== "declined");
  // The sample FSA is a workplace benefit: only the sample people who work for an employer
  // have one (not the freelancer, the retiree or the business owner).
  const employed = sample && !fsaBenefit ? await demoHasEmployer(userId, { client }) : false;
  const election = fsaBenefit
    ? yearlyCost(fsaBenefit)
    : sample && employed
      ? DEMO_FSA_ELECTION_CENTS
      : null;
  // What the FSA has likely paid for: the person's own share of the plan's bills, and dental
  // and vision in full (a plan doesn't pay those). An estimate: Jane can't see FSA claims.
  const planIds = new Set(bills.map((b) => b.id));
  const outlay =
    progress(plan, bills, asOf).oopSoFarCents +
    all.filter((b) => !planIds.has(b.id)).reduce((n, b) => n + b.cents, 0);
  const hsa = accounts.find((a) => a.currentBalanceCents !== null);
  return {
    plan,
    sample,
    progress: progress(plan, bills, asOf),
    bills: bills.map(withNetwork),
    fsa: election === null ? null : fsaStatus(election, outlay, asOf),
    hsa: hsa ? { name: hsa.name, balanceCents: hsa.currentBalanceCents ?? 0 } : null,
    disputes: [Number(year) - 1, Number(year)]
      .flatMap((y) =>
        disputes(
          plan,
          planBills(everyBill.filter((b) => b.date.startsWith(String(y)))),
          (b) => withNetwork(b).network,
        ),
      )
      .map((d) => ({ ...d, network: withNetwork(d.bill).network })),
  };
}

// A decision card for each big bill above the plan's share, for the team to dispute with
// the provider and the plan once the person approves. One per bill, never twice.
export async function openDisputeCards(
  userId: string,
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<number> {
  const year = await loadHealthYear(userId, { client, now });
  if (!year || year.disputes.length === 0) return 0;
  const db = scopedFor(userId, client);
  let opened = 0;
  for (const d of year.disputes) {
    const key = `health-bill:${d.bill.id}`;
    const existing = await db.findings.findFirst({
      where: { type: "bill_negotiation", key },
      select: { id: true },
    });
    if (existing) continue;
    const evidence = {
      merchant: d.bill.provider,
      dispute: true,
      plan: year.plan.label,
      billCents: d.paidCents,
      shouldPayCents: d.shouldPayCents,
      overCents: d.overCents,
      charges: [
        {
          id: d.bill.id,
          date: d.bill.date,
          description: d.bill.provider,
          amountCents: d.paidCents,
        },
      ],
    } satisfies Prisma.InputJsonObject;
    await db.findings.create({
      data: {
        userId,
        type: "bill_negotiation",
        key,
        title: `${d.bill.provider} billed ${formatCents(d.overCents)} more than your plan's share`,
        annualSavingsCents: d.overCents,
        amountCents: d.paidCents,
        confidence: "medium",
        evidence,
      },
    });
    opened += 1;
  }
  if (opened > 0) await track(userId, "health_dispute_opened", { count: opened });
  return opened;
}
