import { cache } from "react";
import { expectedFor, loadTaught, missingRefundAlerts } from "@/lib/unusual";
import {
  COUNT_ONLY_WHEN_APPROVED,
  LOOKBACK_MONTHS,
  MONEY_FOUND_MIN_CONFIDENCE,
  REFUND_FINDING_TYPES,
  RESURFACE_DECLINED_CHANGE,
} from "@/config/detection";
import type { Finding, FindingStatus, FindingType, PrismaClient } from "@/generated/prisma/client";
import { track } from "@/lib/analytics";
import { raiseAlerts } from "@/lib/alerts";
import { confirmRefunds } from "@/lib/agent/refund-check";
import { refundChargesAfterCancel } from "@/lib/agent/run";
import { refreshProposals } from "@/lib/proposals";
import { applyStandingRules } from "@/lib/standing-rules";
import { db as defaultClient } from "@/lib/db";
import { removeOrphans } from "@/lib/evidence/orphans";
import { llmModel } from "@/lib/anthropic";
import { scopedFor, type ScopedDb } from "@/lib/db-scoped";
import { todayOf } from "@/lib/today";
import { cardProducts } from "@/lib/insurance/card-benefits";
import { isDemoItemId } from "@/lib/plaid/demo";
import { BUDGET_SUGGESTION_MONTHS } from "@/config/budgets";
import { budgetSummary, overBudgetAlerts } from "@/insights/budgets";
import { loadInsightTransactions } from "@/insights/load";
import { detectAlerts, dueReportedCategories } from "./alerts";
import { detect } from "./detect";
import { namedByDirectory, withDirectory } from "./merchants";
import { atLeast } from "./helpers";
import { isAmbiguousRecurring } from "./rules/subscription-review";
import { buildStreams } from "./streams";
import { SUBSCRIPTION_PROMPT_VERSION, checkSubscriptions } from "@/lib/subscription-check";
import type { Candidate, DetectionInput, DetectionTransaction } from "./types";
import { isoDate, monthsBefore } from "./units";
import { copiesToLeaveOut } from "@/planning/books";
import { cachedRead } from "@/lib/read-cache";
import { FILE_SOURCE, GIVEN_SOURCE } from "@/lib/import/balances";

// Findings the person can still act on, and the ones where they've said yes.
const OPEN_STATUSES: FindingStatus[] = ["new", "shown", "approved", "in_progress"];
const APPROVED_STATUSES: FindingStatus[] = ["approved", "in_progress"];
// Findings nobody has decided on yet. Only these are removed when a scan stops finding them.
const UNDECIDED_STATUSES: FindingStatus[] = ["new", "shown"];

export type ExistingFinding = Pick<
  Finding,
  | "id"
  | "type"
  | "key"
  | "title"
  | "annualSavingsCents"
  | "amountCents"
  | "confidence"
  | "evidence"
  | "status"
>;

export type Plan = {
  create: Candidate[];
  update: { id: string; candidate: Candidate; resurface: boolean }[];
  remove: string[];
  unchanged: number;
  stillDeclined: number;
};

// JSON with keys sorted, so evidence read back from Postgres (jsonb reorders keys)
// compares equal to the same evidence built fresh.
function stableJson(value: unknown): string {
  return JSON.stringify(value, (_key, v: unknown) =>
    v && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b)))
      : v,
  );
}

function sameContent(existing: ExistingFinding, candidate: Candidate): boolean {
  return (
    existing.title === candidate.title &&
    existing.annualSavingsCents === candidate.annualSavingsCents &&
    existing.amountCents === candidate.amountCents &&
    existing.confidence === candidate.confidence &&
    stableJson(existing.evidence) === stableJson(candidate.evidence)
  );
}

function changedEnough(before: number | null, after: number | null): boolean {
  if (before === null || after === null) return false;
  if (before === 0) return after !== 0;
  return Math.abs(after - before) / Math.abs(before) > RESURFACE_DECLINED_CHANGE;
}

// Subscription findings are keyed "merchant:<merchant key>".
const MERCHANT_KEY_PREFIX = "merchant:";

const idOf = (f: { type: string; key: string }) => `${f.type}\u0000${f.key}`;

// Pure: decides what to write. New opportunities are created; known ones are updated in
// place (keeping their status) only when something changed. A declined finding is left
// exactly as the person declined it, unless its amount moved by more than
// RESURFACE_DECLINED_CHANGE, in which case it comes back as new. Undecided findings this
// scan no longer produces (a cancelled subscription, fees older than the lookback) are
// removed; anything the person has decided on is kept.
export function planChanges(existing: ExistingFinding[], candidates: Candidate[]): Plan {
  const byKey = new Map(existing.map((f) => [idOf(f), f]));
  const detected = new Set(candidates.map(idOf));
  const plan: Plan = {
    create: [],
    update: [],
    remove: existing
      .filter((f) => UNDECIDED_STATUSES.includes(f.status) && !detected.has(idOf(f)))
      .map((f) => f.id),
    unchanged: 0,
    stillDeclined: 0,
  };

  for (const candidate of candidates) {
    const found = byKey.get(idOf(candidate));
    if (!found) {
      plan.create.push(candidate);
    } else if (found.status === "declined") {
      if (changedEnough(found.amountCents, candidate.amountCents)) {
        plan.update.push({ id: found.id, candidate, resurface: true });
      } else {
        plan.stillDeclined += 1;
      }
    } else if (sameContent(found, candidate)) {
      plan.unchanged += 1;
    } else {
      plan.update.push({ id: found.id, candidate, resurface: false });
    }
  }
  return plan;
}

function contentOf(candidate: Candidate) {
  return {
    title: candidate.title,
    annualSavingsCents: candidate.annualSavingsCents,
    amountCents: candidate.amountCents,
    confidence: candidate.confidence,
    evidence: candidate.evidence,
  };
}

const TRANSACTION_SELECT = {
  id: true,
  accountId: true,
  plaidTransactionId: true,
  date: true,
  amountCents: true,
  description: true,
  merchantName: true,
  pfcPrimary: true,
  pfcDetailed: true,
  categorySource: true,
} as const;

async function loadInput(
  db: ScopedDb,
  asOf: string,
  client: PrismaClient,
): Promise<DetectionInput> {
  const cutoff = monthsBefore(asOf, LOOKBACK_MONTHS);
  const [allAccounts, allTransactions, streams, cancelled, directory, first, balanceDays] =
    await Promise.all([
      db.accounts.findMany({
        select: {
          id: true,
          name: true,
          type: true,
          subtype: true,
          currentBalanceCents: true,
          itemId: true,
          mask: true,
          item: { select: { plaidItemId: true } },
        },
        orderBy: { id: "asc" },
      }),
      db.transactions.findMany({
        where: {
          pending: false,
          date: { gt: new Date(`${cutoff}T00:00:00Z`), lte: new Date(`${asOf}T00:00:00Z`) },
        },
        select: TRANSACTION_SELECT,
        orderBy: [{ date: "asc" }, { id: "asc" }],
      }),
      db.recurringStreams.findMany({ orderBy: { id: "asc" } }),
      // Subscriptions our team finished cancelling, for charges that come after.
      db.actions.findMany({
        where: {
          type: "cancel_subscription",
          status: "done",
          completedAt: { not: null },
          decision: { finding: { type: "subscription_review" } },
        },
        select: { completedAt: true, decision: { select: { finding: { select: { key: true } } } } },
        orderBy: { completedAt: "asc" },
      }),
      // The merchant directory is shared, not user data, so it's read without scoping.
      client.merchant.findMany({
        select: { key: true, name: true, aliases: true, category: true },
      }),
      // How far back the person's data goes, before the lookback window too.
      db.transactions.aggregate({ where: { pending: false }, _min: { date: true } }),
      // The day each uploaded account's balance is from: its statement's or the person's
      // (src/lib/import/balances.ts), so the forecast walks it forward to today.
      db.balanceSnapshots.groupBy({
        by: ["accountId"],
        where: { source: { in: [FILE_SOURCE, GIVEN_SOURCE] } },
        _max: { date: true },
      }),
    ]);
  const balanceOn = new Map(
    balanceDays.flatMap((b) => (b._max.date ? [[b.accountId, isoDate(b._max.date)]] : [])),
  );

  // Books QA: an account linked twice (through two logins) counts once.
  const copies = copiesToLeaveOut(allAccounts);
  const accounts = allAccounts.filter((a) => !copies.has(a.id));
  const transactions = allTransactions.filter((t) => !copies.has(t.accountId));

  // Company names and categories from the merchant directory (detection/merchants.ts).
  return withDirectory(
    {
      asOf,
      ...(first._min.date ? { historyFrom: isoDate(first._min.date) } : {}),
      accounts: accounts.map((a) => ({
        id: a.id,
        name: a.name,
        type: a.type,
        subtype: a.subtype,
        currentBalanceCents: a.currentBalanceCents,
        ...(balanceOn.has(a.id) ? { balanceAsOf: balanceOn.get(a.id)! } : {}),
      })),
      // Spec step 152: the cards that come with cover.
      cardProducts: cardProducts(
        accounts.map((a) => ({
          id: a.id,
          name: a.name,
          type: a.type,
          demo: !!a.item && isDemoItemId(a.item.plaidItemId),
        })),
      ),
      transactions: transactions.map((t) => ({ ...t, date: isoDate(t.date) })),
      recurringStreams: streams.map((s) => ({
        ...s,
        lastDate: s.lastDate ? isoDate(s.lastDate) : null,
        predictedNextDate: s.predictedNextDate ? isoDate(s.predictedNextDate) : null,
      })),
      cancelledMerchants: cancelled.flatMap((a) => {
        const key = a.decision.finding.key;
        return a.completedAt && key.startsWith(MERCHANT_KEY_PREFIX)
          ? [
              {
                merchantKey: key.slice(MERCHANT_KEY_PREFIX.length),
                cancelledOn: isoDate(a.completedAt),
              },
            ]
          : [];
      }),
    },
    directory,
  );
}

// The person's settled transactions from one day through another (YYYY-MM-DD, both included),
// read the way detection reads them (loadInput): an account linked twice counts once and names
// come from the merchant directory. The chat's search reads through it, so it finds what the
// cards and pages name (card-chat mismatch: the card said "Apple Store", the search had "Apple").
export async function loadTransactionsBetween(
  userId: string,
  { client = defaultClient, from, to }: { client?: PrismaClient; from: string; to: string },
): Promise<DetectionTransaction[]> {
  const db = scopedFor(userId, client);
  const [accounts, rows, directory] = await Promise.all([
    db.accounts.findMany({
      select: { id: true, name: true, type: true, subtype: true, mask: true, itemId: true },
      orderBy: { id: "asc" },
    }),
    db.transactions.findMany({
      where: {
        pending: false,
        date: { gte: new Date(`${from}T00:00:00Z`), lte: new Date(`${to}T00:00:00Z`) },
      },
      select: TRANSACTION_SELECT,
      orderBy: [{ date: "desc" }, { id: "asc" }],
    }),
    client.merchant.findMany({ select: { key: true, name: true, aliases: true, category: true } }),
  ]);
  const copies = copiesToLeaveOut(accounts);
  return namedByDirectory(
    rows.filter((t) => !copies.has(t.accountId)).map((t) => ({ ...t, date: isoDate(t.date) })),
    directory,
  );
}

// The detection input for one person, for read-only features like upcoming charges.
export async function loadDetectionInput(
  userId: string,
  { client = defaultClient, now = new Date() }: Pick<Options, "client" | "now"> = {},
): Promise<DetectionInput> {
  // The person's own day (src/lib/today.ts): what's due today is due on their calendar.
  const asOf = await todayOf(userId, { client, now });
  if (client !== defaultClient)
    return {
      ...(await cachedRead(`detectionInput:${userId}:${asOf}`, client, () =>
        loadInput(scopedFor(userId, client), asOf, client),
      )),
    };
  // Each caller gets its own copy of the top level: some set subscriptionMerchantKeys on it.
  return { ...(await inputOnce(userId, asOf)) };
}

// Loaded once per server render and day (React's cache): a page's parts each ask for it.
const inputOnce = cache((userId: string, asOf: string) =>
  loadInput(scopedFor(userId, defaultClient), asOf, defaultClient),
);

export type DetectionSummary = {
  counts: Record<FindingType, number>;
  created: number;
  updated: number;
  resurfaced: number;
  removed: number;
  moneyFoundCents: number;
};

const NO_FINDINGS: Record<FindingType, number> = {
  subscription_review: 0,
  duplicate_subscription: 0,
  price_increase: 0,
  bank_fees: 0,
  idle_cash: 0,
  insurance_reshop: 0,
  card_interest: 0,
  low_balance_risk: 0,
  duplicate_charge: 0,
  charge_after_cancel: 0,
  trial_conversion: 0,
  bill_negotiation: 0,
  covered_by_card: 0,
};

type Options = {
  client?: PrismaClient;
  now?: Date;
  checkSubscriptions?: (merchants: string[]) => Promise<Map<string, boolean>>;
  raiseAlerts?: typeof raiseAlerts;
  applyStandingRules?: typeof applyStandingRules;
  confirmRefunds?: typeof confirmRefunds;
  refundChargesAfterCancel?: typeof refundChargesAfterCancel;
};

// Merchant keys Claude has called subscriptions. Recurring charges whose category doesn't
// settle it are asked about once per merchant; every answer, yes or no, is kept so the
// same merchant is never asked twice.
async function subscriptionMerchantKeys(
  db: ScopedDb,
  input: DetectionInput,
  check: (merchants: string[]) => Promise<Map<string, boolean>>,
): Promise<{ yes: string[]; no: string[] }> {
  const stored = await db.subscriptionChecks.findMany({
    select: { merchantKey: true, isSubscription: true },
  });
  const known = new Map(stored.map((c) => [c.merchantKey, c.isSubscription]));

  const keyByName = new Map<string, string>();
  for (const stream of buildStreams(input).filter(isAmbiguousRecurring)) {
    if (!known.has(stream.merchantKey)) keyByName.set(stream.merchant, stream.merchantKey);
  }
  if (keyByName.size > 0) {
    const answers = await check([...keyByName.keys()].sort());
    const rows = [...answers].flatMap(([name, isSubscription]) => {
      const merchantKey = keyByName.get(name);
      return merchantKey ? [{ merchantKey, isSubscription }] : [];
    });
    if (rows.length > 0) {
      await db.subscriptionChecks.createMany({
        data: rows.map((row) => ({
          userId: db.userId,
          ...row,
          model: llmModel(),
          promptVersion: SUBSCRIPTION_PROMPT_VERSION,
        })),
        skipDuplicates: true,
      });
      for (const row of rows) known.set(row.merchantKey, row.isSubscription);
    }
  }
  const keys = (answer: boolean) =>
    [...known]
      .filter(([, isSubscription]) => isSubscription === answer)
      .map(([key]) => key)
      .sort();
  return { yes: keys(true), no: keys(false) };
}

// Runs every rule on the user's data and saves the results. Safe to run as often as we
// like: a second run with the same data changes nothing.
export async function runDetection(
  userId: string,
  {
    client = defaultClient,
    now = new Date(),
    checkSubscriptions: check = checkSubscriptions,
    raiseAlerts: raise = raiseAlerts,
    applyStandingRules: applyRules = applyStandingRules,
    confirmRefunds: confirm = confirmRefunds,
    refundChargesAfterCancel: refundAfterCancel = refundChargesAfterCancel,
  }: Options = {},
): Promise<DetectionSummary> {
  const db = scopedFor(userId, client);
  // First, what was built from data that is gone (a bank disconnected, an upload removed): it
  // goes, decisions and actions included, so nothing says it again (src/lib/evidence/orphans.ts).
  await removeOrphans(userId, { client });
  const input = await loadInput(db, await todayOf(userId, { client, now }), client);
  const answers = await subscriptionMerchantKeys(db, input, check);
  input.subscriptionMerchantKeys = answers.yes;
  input.declinedSubscriptionMerchantKeys = answers.no;
  const candidates = detect(input);
  // A card's interest finding is worth a year of its interest from the balance and rate, the same
  // figure as the brief and the chat (the card interest page); the charges seen stay as the
  // finding's amount. Without that figure (real accounts, no lender partner) the charges seen stand.
  if (candidates.some((c) => c.type === "card_interest")) {
    const { loadCardInterest } = await import("@/lib/card-interest");
    const view = await loadCardInterest(userId, { client, now }).catch(() => null);
    if (view?.available) {
      for (const c of candidates) {
        const card = view.cards.find((x) => `account:${x.accountId}` === c.key);
        if (c.type === "card_interest" && card) {
          c.annualSavingsCents = card.interestYearCents;
          // So its line can say "at today's balance": only this figure is from the balance.
          c.evidence = { ...c.evidence, interestFrom: "balance" };
        }
      }
    }
  }

  const existing = await db.findings.findMany({
    select: {
      id: true,
      type: true,
      key: true,
      title: true,
      annualSavingsCents: true,
      amountCents: true,
      confidence: true,
      evidence: true,
      status: true,
    },
  });
  const plan = planChanges(existing, candidates);

  if (plan.create.length > 0) {
    await db.findings.createMany({
      data: plan.create.map((c) => ({ userId, type: c.type, key: c.key, ...contentOf(c) })),
      // Two scans racing (e.g. two imports at once) can't create the same finding twice.
      skipDuplicates: true,
    });
  }
  if (plan.remove.length > 0) {
    // The status check repeats the plan's, so a finding decided on mid-scan is never lost.
    await db.findings.deleteMany({
      where: { id: { in: plan.remove }, status: { in: UNDECIDED_STATUSES } },
    });
  }
  for (const { id, candidate, resurface } of plan.update) {
    await db.findings.update({
      where: { id },
      data: { ...contentOf(candidate), ...(resurface ? { status: "new" as const } : {}) },
    });
  }

  const firstRun = await client.user.updateMany({
    where: { id: userId, firstDetectionAt: null },
    data: { firstDetectionAt: now },
  });

  // Alerts never stop a scan: if saving or emailing them fails, the findings still stand.
  try {
    const alerts = detectAlerts(input, candidates, {
      knownFindings: new Set(existing.map(idOf)),
      firstScan: firstRun.count > 0,
      taught: await loadTaught(userId, { client }),
      expected: await expectedFor(userId, { client, now }),
      dueReported: dueReportedCategories(
        (
          await db.accounts.findMany({
            where: { type: { in: ["credit", "loan"] } },
            select: {
              type: true,
              subtype: true,
              liability: { select: { nextPaymentDueDate: true } },
            },
          })
        ).map((a) => ({
          type: a.type,
          subtype: a.subtype,
          nextDue: a.liability?.nextPaymentDueDate ? isoDate(a.liability.nextPaymentDueDate) : null,
        })),
        input.asOf,
      ),
    });
    const budgets = await db.budgets.findMany({ select: { category: true, amountCents: true } });
    const overBudget =
      budgets.length === 0
        ? []
        : overBudgetAlerts(
            budgetSummary(
              await loadInsightTransactions(db, input.asOf, BUDGET_SUGGESTION_MONTHS + 1),
              budgets,
              input.asOf,
            ),
          );
    // Spec step 208: refunds that never arrived come from the team's actions.
    const refunds = await missingRefundAlerts(userId, { client, now });
    await raise(userId, [...alerts, ...overBudget, ...refunds], { client, now });
  } catch (error) {
    console.error("Alerts failed", { userId, error: String(error) });
  }

  // The person's standing rules approve matching findings. Like alerts, a failure here
  // never stops the scan.
  try {
    await applyRules(userId, { client, now });
  } catch (error) {
    console.error("Standing rules failed", { userId, error: String(error) });
  }

  // A charge after a cancellation Jane did gets its refund asked for (spec step 53).
  try {
    await refundAfterCancel(userId, { client });
  } catch (error) {
    console.error("Refund after cancel failed", { userId, error: String(error) });
  }

  // Set-up proposals follow the person's numbers (spec step 55).
  try {
    await refreshProposals(userId, { client, now });
  } catch (error) {
    console.error("Proposals failed", { userId, error: String(error) });
  }

  // Refunds coming back in the transactions close their actions (spec step 52).
  try {
    await confirm(userId, { client, now });
  } catch (error) {
    console.error("Refund check failed", { userId, error: String(error) });
  }

  const counts = { ...NO_FINDINGS };
  for (const c of candidates) counts[c.type] += 1;
  const summary: DetectionSummary = {
    counts,
    created: plan.create.length,
    updated: plan.update.filter((u) => !u.resurface).length,
    resurfaced: plan.update.filter((u) => u.resurface).length,
    removed: plan.remove.length,
    moneyFoundCents: await moneyFound(userId, { client }),
  };
  await track(userId, "detection_completed", {
    ...counts,
    created: summary.created,
    updated: summary.updated,
    resurfaced: summary.resurfaced,
    removed: summary.removed,
    money_found_cents: summary.moneyFoundCents,
  });
  return summary;
}

type MoneyFoundRow = Pick<Finding, "type" | "status" | "confidence" | "annualSavingsCents">;

const counted = (f: MoneyFoundRow) =>
  f.annualSavingsCents !== null &&
  OPEN_STATUSES.includes(f.status) &&
  atLeast(f.confidence, MONEY_FOUND_MIN_CONFIDENCE) &&
  (!COUNT_ONLY_WHEN_APPROVED.includes(f.type) || APPROVED_STATUSES.includes(f.status));

// Pure part of moneyFound, so the counting rules can be tested without a database.
export function sumMoneyFound(findings: MoneyFoundRow[]): number {
  return sumMoneyFoundParts(findings).cents;
}

// Money found, and the part of it that comes back once (REFUND_FINDING_TYPES) rather than every
// year, so a page doesn't call a $210 double charge "$210 a year" (debugger 10-31).
export function sumMoneyFoundParts(findings: MoneyFoundRow[]): MoneyFoundParts {
  const open = findings.filter(counted);
  const sum = (list: MoneyFoundRow[]) => list.reduce((s, f) => s + (f.annualSavingsCents ?? 0), 0);
  return {
    cents: sum(open),
    onceCents: sum(open.filter((f) => REFUND_FINDING_TYPES.includes(f.type))),
  };
}

export type MoneyFoundParts = { cents: number; onceCents: number };

// The headline number: savings across open findings we're confident enough in, yearly ones and
// money back once (moneyFoundParts says how much of it is which).
export async function moneyFound(
  userId: string,
  { client = defaultClient }: Pick<Options, "client"> = {},
): Promise<number> {
  return (await moneyFoundParts(userId, { client })).cents;
}

export async function moneyFoundParts(
  userId: string,
  { client = defaultClient }: Pick<Options, "client"> = {},
): Promise<MoneyFoundParts> {
  const findings = await scopedFor(userId, client).findings.findMany({
    where: { status: { in: OPEN_STATUSES }, annualSavingsCents: { not: null } },
    select: { type: true, status: true, confidence: true, annualSavingsCents: true },
  });
  return sumMoneyFoundParts(findings);
}

// True once detection has finished for this user at least once (see /scanning).
export async function isFirstDetectionComplete(
  userId: string,
  { client = defaultClient }: Pick<Options, "client"> = {},
): Promise<boolean> {
  const user = await client.user.findUnique({
    where: { id: userId },
    select: { firstDetectionAt: true },
  });
  return Boolean(user?.firstDetectionAt);
}
