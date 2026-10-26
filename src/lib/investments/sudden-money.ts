import { coreFundsFor } from "@/planning/values";
import { loadPrefs } from "./values";
import { randomUUID } from "node:crypto";
import {
  NOT_SUDDEN_DETAILED,
  NOT_SUDDEN_PRIMARY,
  SUDDEN_DEMO,
  SUDDEN_KINDS,
  SUDDEN_LOOKBACK_DAYS,
  SUDDEN_MIN_CENTS,
  type SuddenKind,
} from "@/config/sudden-money";
import { CAPITAL_GAINS_BRACKETS } from "@/config/tax-rates";
import { FUND_NAMES } from "@/config/funds";
import type { PrismaClient } from "@/generated/prisma/client";
import { adviceMode } from "@/lib/advice-mode";
import { track } from "@/lib/analytics";
import { logAudit } from "@/lib/audit";
import { brokeragePartner } from "@/lib/brokerage/partner";
import { loadDebts } from "@/lib/debts";
import { db as defaultClient } from "@/lib/db";
import { scopedFor } from "@/lib/db-scoped";
import { listGoals } from "@/lib/goals";
import { scheduleTransfer, TransferError } from "@/lib/money-movement/transfers";
import { hasDemoBank } from "@/lib/plaid/demo";
import { syncDemoInvestments } from "@/lib/plaid/sync";
import { loadTaxEstimate } from "@/lib/tax-estimate";
import { loadBaseline as loadWhatIfBaseline } from "@/lib/what-if";
import { contributionBuys } from "@/planning/auto-invest";
import { profileSummary } from "@/planning/investor-profile";
import { marginalRateOf } from "@/planning/tax-estimate";
import {
  suddenPlan,
  taxSetAside,
  type Stage,
  type StageKey,
  type TaxSetAside,
} from "@/planning/sudden-money";
import { loadCash } from "./cash";
import { loadRetirementAccounts, contributeToIra } from "./retirement-accounts";
import { profileOf } from "./profile";

// Sudden money (spec step 235, demo advice), for its page, Jane's question and its buttons.
// A large deposit that isn't pay is asked about once; then a staged plan across every
// sector: tax set aside first (figured by kind), high-interest debt, the emergency fund, the
// retirement limits, goals, and investing last. Every stage is the person's own tap: nothing
// moves by itself.

type Options = { client?: PrismaClient; now?: Date };

export class SuddenMoneyError extends Error {}

const DAY_MS = 86_400_000;
const iso = (d: Date) => d.toISOString().slice(0, 10);

export type SuddenView = {
  id: string;
  amountCents: number;
  depositedOn: string;
  status: string;
  kind: SuddenKind | null;
  tax: TaxSetAside | null;
  stages: (Stage & { done: boolean })[];
  // After the plan: months of spending covered by cash, from the what-if baseline.
  cushionMonths: number | null;
};

export type SuddenMoneyView = { advice: boolean; demo: boolean; items: SuddenView[] };

// New large non-pay deposits become a question, once each.
export async function findSuddenDeposits(userId: string, client: PrismaClient, now: Date) {
  const db = scopedFor(userId, client);
  const rows = await db.transactions.findMany({
    where: {
      amountCents: { lte: -SUDDEN_MIN_CENTS },
      date: { gte: new Date(now.getTime() - SUDDEN_LOOKBACK_DAYS * DAY_MS), lte: now },
      account: { subtype: { in: ["checking", "savings"] } },
      suddenMoney: { is: null },
      OR: [{ pfcDetailed: null }, { pfcDetailed: { notIn: [...NOT_SUDDEN_DETAILED] } }],
    },
    select: { id: true, amountCents: true, date: true, pfcPrimary: true },
  });
  for (const t of rows) {
    if (t.pfcPrimary && NOT_SUDDEN_PRIMARY.includes(t.pfcPrimary)) continue;
    await db.suddenMoneys.create({
      data: { userId, transactionId: t.id, amountCents: -t.amountCents, depositedOn: t.date },
    });
  }
}

export async function classify(
  userId: string,
  id: string,
  kind: SuddenKind | "transfer",
  { client = defaultClient }: Options = {},
) {
  const db = scopedFor(userId, client);
  const data = kind === "transfer" ? { status: "dismissed" } : { kind, status: "planned" };
  if (kind !== "transfer" && !Object.hasOwn(SUDDEN_KINDS, kind))
    throw new SuddenMoneyError("Pick what it was.");
  const { count } = await db.suddenMoneys.updateMany({ where: { id, status: "asked" }, data });
  if (count === 0) throw new SuddenMoneyError("That question was already answered.");
  await logAudit(
    { type: "user", id: userId },
    "sudden_money_classed",
    { type: "sudden_money", id },
    { kind },
  );
  await track(userId, "sudden_money_classed", { kind });
}

export async function loadSuddenMoney(
  userId: string,
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<SuddenMoneyView> {
  await findSuddenDeposits(userId, client, now);
  const db = scopedFor(userId, client);
  const [advice, demo, rows] = await Promise.all([
    adviceMode(userId, { client }),
    hasDemoBank(userId, { client }),
    db.suddenMoneys.findMany({
      where: { status: { in: ["asked", "planned"] } },
      orderBy: { depositedOn: "desc" },
    }),
  ]);
  if (rows.length === 0) return { advice, demo, items: [] };
  const [estimate, book, cash, retirement, goals, baseline] = await Promise.all([
    loadTaxEstimate(userId, { client, now }).catch(() => null),
    loadDebts(userId, { client, now }),
    loadCash(userId, { client, now }),
    loadRetirementAccounts(userId, { client, now }),
    listGoals(userId, { client, now }),
    loadWhatIfBaseline(userId, { client, now }).catch(() => null),
  ]);
  const marginal = estimate?.estimate.marginalRate ?? baseline?.marginalRate ?? 0.22;
  const filing = estimate?.estimate.filingStatus === "married_joint" ? "married_joint" : "single";
  const gainRate =
    estimate?.estimate.taxableCents != null
      ? marginalRateOf(
          estimate.estimate.taxableCents,
          CAPITAL_GAINS_BRACKETS[estimate.estimate.filingStatus ?? "single"],
        )
      : 0.15;
  const savings = cash.places
    .filter((p) => p.kind === "savings")
    .reduce((s, p) => s + p.balanceCents, 0);
  const emergencyGap = Math.max(0, cash.emergencyTargetCents - savings);
  const items = rows.map((r): SuddenView => {
    const kind = (r.kind as SuddenKind | null) ?? null;
    const done = new Set(Array.isArray(r.done) ? (r.done as string[]) : []);
    if (!kind) {
      return {
        id: r.id,
        amountCents: r.amountCents,
        depositedOn: iso(r.depositedOn),
        status: r.status,
        kind: null,
        tax: null,
        stages: [],
        cushionMonths: null,
      };
    }
    const tax = taxSetAside({
      kind,
      amountCents: r.amountCents,
      marginalRate: marginal,
      gainRate,
      filing,
      basisCents: r.basisCents,
    });
    const stages = suddenPlan({
      amountCents: r.amountCents,
      tax,
      cards: book.debts.flatMap((d) =>
        d.balanceCents && d.aprBps && d.accountId
          ? [{ name: d.name, balanceCents: d.balanceCents, aprBps: d.aprBps }]
          : [],
      ),
      emergencyGapCents: emergencyGap,
      iraRoomCents: retirement.ira ? retirement.iraAllowedCents : 0,
      goalShortfalls: goals.flatMap((g) =>
        g.progress.status === "on_the_way" ? [{ name: g.name, cents: g.progress.leftCents }] : [],
      ),
    }).map((s) => ({ ...s, done: done.has(s.key) }));
    const spend = baseline?.monthlySpendingCents ?? 0;
    return {
      id: r.id,
      amountCents: r.amountCents,
      depositedOn: iso(r.depositedOn),
      status: r.status,
      kind,
      tax,
      stages,
      cushionMonths:
        spend > 0
          ? Math.round(
              (((baseline?.cashCents ?? 0) +
                r.amountCents -
                stages
                  .filter((s) => s.key === "investing" || s.key === "limits")
                  .reduce((a, s) => a + s.cents, 0)) /
                spend) *
                10,
            ) / 10
          : null,
    };
  });
  return { advice, demo, items };
}

// Tap: one stage of the plan, in order (a later stage waits for the earlier ones). The money
// is the person's own, moved between their accounts through the stand-ins.
export async function doStage(
  userId: string,
  id: string,
  stageKey: StageKey,
  { client = defaultClient, now = new Date() }: Options = {},
) {
  const view = await loadSuddenMoney(userId, { client, now });
  if (!view.advice) throw new SuddenMoneyError("This is only in demo advice mode for now.");
  const item = view.items.find((i) => i.id === id && i.status === "planned");
  if (!item) throw new SuddenMoneyError("That plan isn't open any more.");
  const index = item.stages.findIndex((s) => s.key === stageKey);
  const stage = item.stages[index];
  if (!stage || stage.done)
    throw new SuddenMoneyError("That part is already done or isn't in the plan.");
  if (item.stages.slice(0, index).some((s) => !s.done))
    throw new SuddenMoneyError("An earlier part comes first: the tax set-aside always does.");
  const db = scopedFor(userId, client);
  const accounts = await db.accounts.findMany({
    where: { type: { in: ["depository", "credit", "investment"] } },
    select: { id: true, name: true, subtype: true },
  });
  const checking = accounts.find((a) => a.subtype === "checking");
  const savings = accounts.find((a) => a.subtype === "savings");
  try {
    if (stage.key === "taxes" || stage.key === "emergency" || stage.key === "goals") {
      if (!checking || !savings)
        throw new SuddenMoneyError("I need a checking and a savings account to move this.");
      const goal =
        stage.key === "goals"
          ? (await listGoals(userId, { client, now })).find(
              (g) => g.progress.status === "on_the_way",
            )
          : undefined;
      await scheduleTransfer(
        userId,
        {
          fromAccountId: checking.id,
          toAccountId: savings.id,
          toName:
            stage.key === "taxes"
              ? "Tax set-aside"
              : stage.key === "emergency"
                ? "Emergency fund"
                : (goal?.name ?? "Goals"),
          amountCents: stage.cents,
          purpose: "goal",
          sector: stage.key === "taxes" ? "taxes" : "goals",
          goalId: goal?.id ?? null,
          planKey: `sudden:${id}:${stage.key}`,
        },
        "person",
        { client, now },
      );
    } else if (stage.key === "debt") {
      const book = await loadDebts(userId, { client, now });
      const card = book.debts
        .filter((d) => d.accountId && d.balanceCents && (d.aprBps ?? 0) >= 800)
        .sort((a, b) => (b.aprBps ?? 0) - (a.aprBps ?? 0))[0];
      if (!checking || !card?.accountId)
        throw new SuddenMoneyError("I can't find the card to pay.");
      await scheduleTransfer(
        userId,
        {
          fromAccountId: checking.id,
          toAccountId: card.accountId,
          toName: card.name,
          amountCents: Math.min(stage.cents, card.balanceCents ?? stage.cents),
          purpose: "debt",
          sector: "debt",
          planKey: `sudden:${id}:debt`,
        },
        "person",
        { client, now },
      );
    } else if (stage.key === "limits") {
      await contributeToIra(userId, stage.cents, { client, now });
    } else {
      const brokerage = accounts.find((a) => a.subtype === "brokerage");
      if (!brokerage) throw new SuddenMoneyError("I need a brokerage account to invest in.");
      const profile = profileSummary(await profileOf(userId, { client }), iso(now));
      const partner = brokeragePartner();
      const buys = contributionBuys(
        stage.cents,
        profile.complete ? profile.riskLevel : 3,
        coreFundsFor(await loadPrefs(userId, { client })),
      );
      await partner.placeOrders(
        userId,
        {
          batchId: randomUUID(),
          reason: "sudden_money",
          orders: [
            {
              accountId: brokerage.id,
              ticker: "CASH",
              securityName: "Deposit from checking",
              side: "deposit",
              amountCents: stage.cents,
            },
            ...buys.map((b) => ({
              accountId: brokerage.id,
              ticker: b.ticker,
              securityName: FUND_NAMES[b.ticker] ?? b.ticker,
              side: "buy" as const,
              amountCents: b.amountCents,
            })),
          ],
        },
        { client, now },
      );
      const acc = await db.accounts.findFirst({
        where: { id: brokerage.id },
        select: { itemId: true },
      });
      if (acc?.itemId) await syncDemoInvestments(acc.itemId, { client, now });
    }
  } catch (error) {
    if (error instanceof TransferError) throw new SuddenMoneyError(error.message);
    throw error;
  }
  const row = await db.suddenMoneys.findFirstOrThrow({ where: { id } });
  const done = [...(Array.isArray(row.done) ? (row.done as string[]) : []), stage.key];
  await db.suddenMoneys.updateMany({
    where: { id },
    data: { done, status: done.length >= item.stages.length ? "dismissed" : "planned" },
  });
  await logAudit(
    { type: "user", id: userId },
    "sudden_money_stage",
    { type: "sudden_money", id },
    { stage: stage.key },
  );
  await track(userId, "sudden_money_stage", { stage: stage.key });
  return { stage: stage.key, cents: stage.cents };
}

// Demo-bank people: a bonus deposit in checking to try the plan.
export async function addDemoDeposit(
  userId: string,
  { client = defaultClient, now = new Date() }: Options = {},
) {
  const db = scopedFor(userId, client);
  if (!(await hasDemoBank(userId, { client })))
    throw new SuddenMoneyError("A demo deposit needs the demo bank.");
  const checking = await db.accounts.findFirst({
    where: { subtype: "checking" },
    select: { id: true },
  });
  if (!checking) throw new SuddenMoneyError("Link a checking account first.");
  await db.transactions.create({
    data: {
      userId,
      accountId: checking.id,
      source: "plaid",
      plaidTransactionId: `demo-sudden-${userId}-${iso(now)}`,
      date: new Date(`${iso(now)}T00:00:00Z`),
      amountCents: -SUDDEN_DEMO.amountCents,
      description: SUDDEN_DEMO.description,
      pfcPrimary: "INCOME",
      pfcDetailed: "INCOME_OTHER_INCOME",
      categorySource: "plaid",
      pending: false,
    },
  });
}
