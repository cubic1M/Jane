import { randomUUID } from "node:crypto";
import { EMPLOYER_CONTRIBUTION } from "@/config/retirement";
import {
  CONTRIBUTION_TX_SUBTYPES,
  DEMO_IRA_FUND,
  IRA_SUBTYPES,
  WORKPLACE_SUBTYPES,
} from "@/config/retirement-accounts";
import { FUND_NAMES } from "@/config/funds";
import type { FilingStatus } from "@/config/tax";
import type { PrismaClient } from "@/generated/prisma/client";
import { adviceMode } from "@/lib/advice-mode";
import { track } from "@/lib/analytics";
import { logAudit } from "@/lib/audit";
import { brokeragePartner } from "@/lib/brokerage/partner";
import { db as defaultClient } from "@/lib/db";
import { scopedFor } from "@/lib/db-scoped";
import { payrollPartner } from "@/lib/payroll/partner";
import { addDemoExtra } from "@/lib/plaid/demo";
import { syncDemoInvestments } from "@/lib/plaid/sync";
import { loadTaxEstimate } from "@/lib/tax-estimate";
import { currentAge } from "@/planning/investor-profile";
import {
  limitRows,
  matchGap,
  matchPaceGap,
  rothAccess,
  rothByBracket,
  type LimitRow,
  type RothAccess,
} from "@/planning/retirement-accounts";
import { employerPlanFor } from "./employer-plan";
import { profileOf } from "./profile";

// Retirement accounts used fully (spec step 210, demo advice), for its page, Jane's
// answers and her buttons. Every limit tracked across accounts, the match left on the
// table, Roth or traditional by bracket, the backdoor Roth. A payroll change goes through
// the payroll stand-in and an IRA contribution through the simulated brokerage, each only
// on the person's tap.

type Options = { client?: PrismaClient; now?: Date };

export class RetirementAccountsError extends Error {}

export type RetirementAccountsView = {
  advice: boolean;
  age: number | null;
  limits: LimitRow[];
  match: (ReturnType<typeof matchGap> & { matchRate: number }) | null;
  roth: {
    choice: ReturnType<typeof rothByBracket>;
    marginalRate: number | null;
    fromEstimate: boolean;
    access: RothAccess | null;
    magiCents: number | null;
  };
  // The IRA the person could contribute to through Jane, if any.
  ira: { id: string; name: string; roth: boolean } | null;
  // Most they could put in an IRA now by their income: room times the allowed share.
  iraAllowedCents: number;
  demo: boolean;
  pending: { fromRate: number; toRate: number; effectiveOn: string } | null;
};

export async function loadRetirementAccounts(
  userId: string,
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<RetirementAccountsView> {
  const db = scopedFor(userId, client);
  const year = now.getUTCFullYear();
  const [advice, answers, plan, accounts, estimate, change, demoItem] = await Promise.all([
    adviceMode(userId, { client }),
    profileOf(userId, { client }),
    employerPlanFor(userId, client),
    db.accounts.findMany({
      where: { type: "investment" },
      select: { id: true, name: true, subtype: true },
    }),
    loadTaxEstimate(userId, { client, now }).catch(() => null),
    db.payrollChanges.findFirst({ orderBy: { createdAt: "desc" } }),
    db.plaidItems.findFirst({
      where: { plaidItemId: { startsWith: "demo-" } },
      select: { id: true },
    }),
  ]);
  const age = currentAge(answers, now.toISOString().slice(0, 10));
  const sub = (a: { subtype: string | null }) => (a.subtype ?? "").toLowerCase();
  const workplace = accounts.filter((a) => WORKPLACE_SUBTYPES.includes(sub(a)));
  const iras = accounts.filter((a) => IRA_SUBTYPES.includes(sub(a)));
  const ids = [...workplace, ...iras].map((a) => a.id);
  const txs =
    ids.length === 0
      ? []
      : await db.investmentTransactions.findMany({
          where: {
            accountId: { in: ids },
            subtype: { in: [...CONTRIBUTION_TX_SUBTYPES] },
            date: { gte: new Date(Date.UTC(year, 0, 1)), lte: now },
          },
          select: { accountId: true, name: true, amountCents: true },
        });
  // Money in is negative in Plaid's sign.
  const paidIn = (accts: { id: string }[], employer: boolean | null) =>
    txs
      .filter(
        (t) =>
          accts.some((a) => a.id === t.accountId) &&
          (employer === null || EMPLOYER_CONTRIBUTION.test(t.name) === employer),
      )
      .reduce((s, t) => s - t.amountCents, 0);
  const limits = limitRows({
    age: age ?? 40,
    workplaceUsedCents: Math.max(0, paidIn(workplace, false)),
    iraUsedCents: Math.max(0, paidIn(iras, null)),
  });
  const employeeYtd = Math.max(0, paidIn(workplace, false));
  // The match: this year's pace of the person's own contributions against full-year pay.
  const match = plan && employeeYtd >= 0 ? matchPaceGap(plan, employeeYtd, now) : null;
  const marginalRate = estimate?.estimate.marginalRate ?? null;
  const filing: FilingStatus = estimate?.estimate.filingStatus ?? "single";
  const magi = estimate?.estimate.agiCents ?? null;
  const access = magi !== null ? rothAccess(magi, filing) : null;
  const iraRoom = limits.find((l) => l.key === "ira")!.roomCents;
  const roth = iras.find((a) => sub(a) === "roth");
  const target = roth ?? iras[0] ?? null;
  return {
    advice,
    age,
    limits,
    match,
    roth: {
      choice: rothByBracket(marginalRate),
      marginalRate,
      fromEstimate: marginalRate !== null,
      access,
      magiCents: magi,
    },
    ira: target ? { id: target.id, name: target.name, roth: sub(target) === "roth" } : null,
    iraAllowedCents:
      access && access.kind !== "backdoor" ? Math.floor(iraRoom * access.allowedShare) : iraRoom,
    demo: demoItem !== null,
    pending:
      change && change.status === "requested"
        ? {
            fromRate: change.fromRate,
            toRate: change.toRate,
            effectiveOn: change.effectiveOn.toISOString().slice(0, 10),
          }
        : null,
  };
}

// Tap: raise the person's contribution at work to the rate that gets the whole match,
// through the payroll partner. Effective from the first paycheck after a week.
export async function requestMatchRaise(
  userId: string,
  { client = defaultClient, now = new Date() }: Options = {},
) {
  const view = await loadRetirementAccounts(userId, { client, now });
  if (!view.advice) throw new RetirementAccountsError("This is only in demo advice mode for now.");
  if (!view.match || view.match.missedCents <= 0)
    throw new RetirementAccountsError("You're already getting the whole match.");
  if (view.pending)
    throw new RetirementAccountsError("A change to your contribution is already requested.");
  const partner = payrollPartner();
  const effectiveOn = new Date(now.getTime() + 7 * 86_400_000).toISOString().slice(0, 10);
  const { partnerRef } = await partner.requestContributionChange({
    fromRate: view.match.employeeRate,
    toRate: view.match.fullMatchRate,
    effectiveOn,
  });
  const row = await scopedFor(userId, client).payrollChanges.create({
    data: {
      userId,
      partner: partner.name,
      partnerRef,
      fromRate: view.match.employeeRate,
      toRate: view.match.fullMatchRate,
      effectiveOn: new Date(`${effectiveOn}T00:00:00Z`),
    },
    select: { id: true },
  });
  await logAudit(
    { type: "user", id: userId },
    "payroll_change_requested",
    { type: "payroll_change", id: row.id },
    { simulated: partner.simulated },
  );
  await track(userId, "payroll_change_requested", {});
  return { toRate: view.match.fullMatchRate, effectiveOn, missedCents: view.match.missedCents };
}

// Tap: put money in the person's IRA (up to what their income allows) from checking, into
// a stock index fund, through the simulated brokerage.
export async function contributeToIra(
  userId: string,
  amountCents: number,
  { client = defaultClient, now = new Date() }: Options = {},
) {
  const view = await loadRetirementAccounts(userId, { client, now });
  if (!view.advice) throw new RetirementAccountsError("This is only in demo advice mode for now.");
  if (!view.ira) throw new RetirementAccountsError("There's no IRA linked.");
  if (view.roth.access?.kind === "backdoor")
    throw new RetirementAccountsError(
      "Your income is over the Roth IRA limit: the backdoor route needs a tax professional's check first.",
    );
  if (!Number.isInteger(amountCents) || amountCents <= 0 || amountCents > view.iraAllowedCents)
    throw new RetirementAccountsError("That's more than you can put in an IRA this year.");
  const partner = brokeragePartner();
  const batchId = randomUUID();
  await partner.placeOrders(
    userId,
    {
      batchId,
      reason: "ira_contribution",
      orders: [
        {
          accountId: view.ira.id,
          ticker: "CASH",
          securityName: "Contribution from checking",
          side: "deposit",
          amountCents,
        },
        {
          accountId: view.ira.id,
          ticker: DEMO_IRA_FUND,
          securityName: FUND_NAMES[DEMO_IRA_FUND] ?? DEMO_IRA_FUND,
          side: "buy",
          amountCents,
        },
      ],
    },
    { client, now },
  );
  await logAudit(
    { type: "user", id: userId },
    "brokerage_orders_placed",
    { type: "brokerage_batch", id: batchId },
    { reason: "ira_contribution", orders: 2, simulated: partner.simulated },
  );
  const item = await scopedFor(userId, client).accounts.findFirst({
    where: { id: view.ira.id },
    select: { itemId: true },
  });
  if (item?.itemId) await syncDemoInvestments(item.itemId, { client, now });
  return { amountCents, accountName: view.ira.name };
}

export async function linkDemoRothIra(
  userId: string,
  { client = defaultClient, now = new Date() }: Options = {},
) {
  const itemId = await addDemoExtra(userId, "roth_ira", { client });
  if (!itemId) throw new RetirementAccountsError("A demo Roth IRA needs the demo bank.");
  await syncDemoInvestments(itemId, { client, now });
  await track(userId, "demo_roth_ira_linked", {});
}
