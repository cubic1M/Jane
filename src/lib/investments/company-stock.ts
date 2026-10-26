import { createHash, randomUUID } from "node:crypto";
import {
  DEFAULT_LONG_TERM_RATE,
  DEFAULT_SHORT_TERM_RATE,
  DIVERSIFY_MONTHS_APART,
  GRANT_KINDS,
  type GrantKind,
} from "@/config/company-stock";
import { CORE_FUNDS, FUND_NAMES } from "@/config/funds";
import { TARGET_MIXES } from "@/config/investing";
import { TAXABLE_INVESTMENT_SUBTYPES } from "@/config/tax";
import { CAPITAL_GAINS_BRACKETS } from "@/config/tax-rates";
import type { PrismaClient } from "@/generated/prisma/client";
import type { HoldingView } from "@/insights/investments";
import { isEmployer } from "@/insights/portfolio-review";
import { adviceMode } from "@/lib/advice-mode";
import { track } from "@/lib/analytics";
import { logAudit } from "@/lib/audit";
import { brokeragePartner } from "@/lib/brokerage/partner";
import { db as defaultClient } from "@/lib/db";
import { scopedFor } from "@/lib/db-scoped";
import { addDemoExtra } from "@/lib/plaid/demo";
import { syncDemoInvestments } from "@/lib/plaid/sync";
import { loadTaxEstimate } from "@/lib/tax-estimate";
import {
  concentration,
  diversifyPlan,
  type Concentration,
  type DiversifyPlan,
} from "@/planning/company-stock";
import { lotsFor } from "@/planning/investment-taxes";
import { profileSummary } from "@/planning/investor-profile";
import { marginalRateOf } from "@/planning/tax-estimate";
import { loadInvestments } from "./holdings";
import { profileOf } from "./profile";

// Company stock (spec step 160), for its page, Jane's answers, its buttons and tools. The
// employer is spotted from who pays the person; vested shares are holdings; what's still
// coming is in equity_grants. The plan's tax cost uses step 124's lots and step 120's rates.
// Selling is always the person's tap, one part at a time.

type Options = { client?: PrismaClient; now?: Date };

export class CompanyStockError extends Error {}

const DAY_MS = 86_400_000;
const iso = (d: Date) => d.toISOString().slice(0, 10);
const addMonths = (day: string, months: number) => {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + months);
  return iso(d);
};

export type CompanyStockView = {
  advice: boolean;
  company: string | null;
  ticker: string | null;
  holdings: (HoldingView & { accountName: string; accountId: string })[];
  grants: {
    id: string;
    company: string;
    kind: GrantKind;
    unvestedShares: number;
    sharesPerVest: number | null;
    everyMonths: number | null;
    nextVestOn: string | null;
    source: string;
  }[];
  concentration: Concentration;
  plan:
    | (DiversifyPlan & { key: string; accountId: string; accountName: string; nextDue: string })
    | null;
  rates: { longTerm: number; shortTerm: number; fromEstimate: boolean };
  demo: boolean;
};

export async function loadCompanyStock(
  userId: string,
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<CompanyStockView> {
  const db = scopedFor(userId, client);
  const today = iso(now);
  const [advice, investments, pay, grants, estimate, lastSale, demoItem] = await Promise.all([
    adviceMode(userId, { client }),
    loadInvestments(userId, { client, now }),
    db.transactions.findMany({
      where: {
        pfcPrimary: "INCOME",
        amountCents: { lt: 0 },
        date: { gte: new Date(now.getTime() - 90 * DAY_MS) },
      },
      select: { description: true, merchantName: true },
      distinct: ["description"],
      take: 20,
    }),
    db.equityGrants.findMany({ orderBy: { createdAt: "asc" } }),
    loadTaxEstimate(userId, { client, now }).catch(() => null),
    db.brokerageOrders.findFirst({
      where: { reason: "diversify", status: "filled" },
      select: { placedAt: true },
      orderBy: { placedAt: "desc" },
    }),
    db.plaidItems.findFirst({
      where: { plaidItemId: { startsWith: "demo-" } },
      select: { id: true },
    }),
  ]);
  const payNames = pay.flatMap((p) => [p.description, ...(p.merchantName ? [p.merchantName] : [])]);
  const all = investments.accounts.flatMap((a) =>
    a.holdings.map((h) => ({ ...h, accountName: a.name, accountId: a.id, subtype: a.subtype })),
  );
  const grantTickers = new Set(grants.map((g) => g.ticker?.toUpperCase()).filter(Boolean));
  const employer = all.filter(
    (h) =>
      h.type === "equity" && (isEmployer(h, payNames) || grantTickers.has(h.ticker?.toUpperCase())),
  );
  const ticker = employer[0]?.ticker ?? grants[0]?.ticker ?? null;
  const company = employer[0]?.name ?? grants[0]?.company ?? null;
  const priceCents = employer[0]?.priceCents ?? 0;
  const held = employer.reduce((s, h) => s + h.valueCents, 0);
  const unvested = grants
    .filter((g) => !ticker || g.ticker?.toUpperCase() === ticker.toUpperCase())
    .reduce((s, g) => s + Math.round(g.unvestedShares * priceCents), 0);
  const total = investments.accounts.reduce((s, a) => s + a.holdingsCents, 0);

  // Tax rates: from the tax estimate when there is one.
  const taxable = estimate?.estimate.taxableCents ?? null;
  const status = estimate?.estimate.filingStatus ?? "single";
  const rates =
    taxable !== null && estimate
      ? {
          longTerm: marginalRateOf(taxable, CAPITAL_GAINS_BRACKETS[status]),
          shortTerm: estimate.estimate.marginalRate,
          fromEstimate: true,
        }
      : {
          longTerm: DEFAULT_LONG_TERM_RATE,
          shortTerm: DEFAULT_SHORT_TERM_RATE,
          fromEstimate: false,
        };

  // The plan sells from the biggest taxable holding of the employer's stock.
  const source = employer
    .filter((h) => TAXABLE_INVESTMENT_SUBTYPES.includes((h.subtype ?? "").toLowerCase()))
    .sort((a, b) => b.valueCents - a.valueCents)[0];
  let plan: CompanyStockView["plan"] = null;
  if (source && source.costBasisCents !== null) {
    const txs = await db.investmentTransactions.findMany({
      where: { accountId: source.accountId, security: { ticker: source.ticker } },
      select: {
        accountId: true,
        securityId: true,
        date: true,
        type: true,
        subtype: true,
        quantity: true,
        amountCents: true,
      },
    });
    const { left } = lotsFor(
      source.quantity,
      txs.map((t) => ({ ...t, date: iso(t.date) })),
    );
    // Parts are three months apart; the next one is due three months after the last sale.
    const nextDue = lastSale ? addMonths(iso(lastSale.placedAt), DIVERSIFY_MONTHS_APART) : today;
    const start = nextDue > today ? nextDue : today;
    // Sold from this account; the employer stock elsewhere counts towards the limit too.
    const chosen = diversifyPlan({
      quantity: source.quantity,
      priceCents: source.priceCents,
      costBasisCents: source.costBasisCents,
      lots: left,
      totalInvestedCents: total,
      today: start,
      rates,
      otherCents: held - source.valueCents,
    });
    plan = {
      ...chosen,
      // The plan the person saw: the same shares, the same due date (prices move daily).
      key: createHash("sha256")
        .update(JSON.stringify([source.accountId, source.ticker, source.quantity, start]))
        .digest("hex")
        .slice(0, 24),
      accountId: source.accountId,
      accountName: source.accountName,
      nextDue: start,
    };
  }
  return {
    advice,
    company,
    ticker,
    holdings: employer,
    grants: grants.map((g) => ({
      id: g.id,
      company: g.company,
      kind: (Object.hasOwn(GRANT_KINDS, g.kind) ? g.kind : "rsu") as GrantKind,
      unvestedShares: g.unvestedShares,
      sharesPerVest: g.sharesPerVest,
      everyMonths: g.everyMonths,
      nextVestOn: g.nextVestOn ? iso(g.nextVestOn) : null,
      source: g.source,
    })),
    concentration: concentration({
      heldCents: held,
      unvestedCents: unvested,
      totalInvestedCents: total,
    }),
    plan,
    rates,
    demo: demoItem !== null,
  };
}

// One part of the plan, now: sell that much of the employer's stock and buy broad index
// funds in the same account, through the brokerage partner. Only the part that's due, and
// only while the plan is the one the person saw.
export async function sellPart(
  userId: string,
  key: string,
  { client = defaultClient, now = new Date() }: Options = {},
) {
  const view = await loadCompanyStock(userId, { client, now });
  if (!view.advice)
    throw new CompanyStockError("Selling company stock is only in demo advice mode for now.");
  const plan = view.plan;
  const part = plan?.parts[0];
  if (!plan || !part || !view.ticker)
    throw new CompanyStockError("There's nothing to sell: your company stock is within the limit.");
  if (plan.key !== key)
    throw new CompanyStockError("Your holdings changed since this plan. Here's the new one.");
  if (part.on > iso(now)) throw new CompanyStockError(`The next part isn't due until ${part.on}.`);
  const answers = await profileOf(userId, { client });
  const profile = profileSummary(answers, iso(now));
  const mix = TARGET_MIXES[profile.complete ? profile.riskLevel : 3];
  const invested = mix.us_stocks + mix.intl_stocks + mix.bonds;
  const buys = (["us_stocks", "intl_stocks", "bonds"] as const).map((c) => ({
    ticker: CORE_FUNDS[c],
    amountCents: Math.floor((part.proceedsCents * mix[c]) / invested),
  }));
  const partner = brokeragePartner();
  const batchId = randomUUID();
  const confirmations = await partner.placeOrders(
    userId,
    {
      batchId,
      reason: "diversify",
      orders: [
        {
          accountId: plan.accountId,
          ticker: view.ticker,
          securityName: view.company ?? view.ticker,
          side: "sell",
          amountCents: part.proceedsCents,
        },
        ...buys
          .filter((b) => b.amountCents > 0)
          .map((b) => ({
            accountId: plan.accountId,
            ticker: b.ticker,
            securityName: FUND_NAMES[b.ticker] ?? b.ticker,
            side: "buy" as const,
            amountCents: b.amountCents,
          })),
      ],
    },
    { client, now },
  );
  await logAudit(
    { type: "user", id: userId },
    "brokerage_orders_placed",
    { type: "brokerage_batch", id: batchId },
    { reason: "diversify", orders: confirmations.length, simulated: partner.simulated },
  );
  await track(userId, "company_stock_sold", { part: part.index });
  const account = await scopedFor(userId, client).accounts.findFirst({
    where: { id: plan.accountId },
    select: { itemId: true },
  });
  if (account?.itemId) await syncDemoInvestments(account.itemId, { client, now });
  return { part, confirmations };
}

export type GrantInput = {
  company: string;
  ticker: string;
  kind: string;
  unvestedShares: string;
  sharesPerVest: string;
  everyMonths: string;
  nextVestOn: string;
};

// The guided form: one grant, checked.
export async function saveGrant(
  userId: string,
  input: GrantInput,
  { client = defaultClient }: Options = {},
) {
  const company = input.company.trim().slice(0, 60);
  if (!company) throw new CompanyStockError("Enter the company's name.");
  if (!Object.hasOwn(GRANT_KINDS, input.kind))
    throw new CompanyStockError("Pick the kind of grant.");
  const unvested = Number(input.unvestedShares);
  if (!Number.isFinite(unvested) || unvested < 0 || unvested > 10_000_000) {
    throw new CompanyStockError("Enter how many shares are still to vest (0 if none).");
  }
  const perVest = input.sharesPerVest.trim() ? Number(input.sharesPerVest) : null;
  const every = input.everyMonths.trim() ? Math.round(Number(input.everyMonths)) : null;
  const next = /^\d{4}-\d{2}-\d{2}$/.test(input.nextVestOn)
    ? new Date(`${input.nextVestOn}T00:00:00Z`)
    : null;
  const grant = await scopedFor(userId, client).equityGrants.create({
    data: {
      userId,
      company,
      ticker: input.ticker.trim().toUpperCase().slice(0, 10) || null,
      kind: input.kind,
      unvestedShares: unvested,
      sharesPerVest: perVest !== null && Number.isFinite(perVest) ? perVest : null,
      everyMonths: every !== null && Number.isFinite(every) ? every : null,
      nextVestOn: next,
    },
    select: { id: true },
  });
  await logAudit(
    { type: "user", id: userId },
    "equity_grant_saved",
    { type: "equity_grant", id: grant.id },
    { kind: input.kind },
  );
  return grant.id;
}

// The demo stock plan: vested Acme shares, and 120 more vesting 30 a quarter.
export async function linkDemoStockPlan(
  userId: string,
  { client = defaultClient, now = new Date() }: Options = {},
) {
  const itemId = await addDemoExtra(userId, "stock_plan", { client });
  if (!itemId) throw new CompanyStockError("A demo stock plan needs the demo bank.");
  await syncDemoInvestments(itemId, { client, now });
  const db = scopedFor(userId, client);
  if ((await db.equityGrants.count({ where: { source: "demo" } })) === 0) {
    await db.equityGrants.create({
      data: {
        userId,
        company: "Acme Corp",
        ticker: "ACME",
        kind: "rsu",
        unvestedShares: 120,
        sharesPerVest: 30,
        everyMonths: 3,
        nextVestOn: new Date(now.getTime() + 21 * DAY_MS),
        source: "demo",
      },
    });
  }
  await track(userId, "demo_stock_plan_linked", {});
}
