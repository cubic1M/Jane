import {
  EQUITY_EVENT_KINDS,
  EQUITY_SET_ASIDE_MIN_CENTS,
  type EquityEventKind,
} from "@/config/equity-tax";
import type { PrismaClient } from "@/generated/prisma/client";
import { adviceMode } from "@/lib/advice-mode";
import { track } from "@/lib/analytics";
import { logAudit } from "@/lib/audit";
import { db as defaultClient } from "@/lib/db";
import { scopedFor } from "@/lib/db-scoped";
import { loadEquityIncome, toEvent, type EquityIncome } from "@/lib/equity-income";
import { addGoal } from "@/lib/goals";
import { loadTaxDocuments } from "@/lib/tax-documents";
import { loadTaxEstimate, type TaxEstimateView } from "@/lib/tax-estimate";
import { totals } from "@/planning/crypto-tax";
import { defaultTaxYear } from "@/planning/tax-pack";
import { assumedRsuGap, rsuVest, worthSettingAside, type RsuResult } from "@/planning/equity-tax";
import { estimateTaxes } from "@/planning/tax-estimate";
import { isoDay as iso } from "@/lib/dates";

// Crypto and equity pay, taxed right (spec step 219), for its page, the chat and Claude: the
// crypto gains by lot, ESPP sales that lost their special treatment, ISO exercises with the
// AMT, and RSU withholding that falls short, all in the estimate, with the amount to set
// aside and a goal for it. Jane sets nothing aside by moving money: the goal is a tracker.

type Options = { client?: PrismaClient; now?: Date };

export class EquityTaxError extends Error {}

export type EquityTaxView = {
  year: number;
  advice: boolean;
  income: EquityIncome;
  cryptoYear: ReturnType<typeof totals>;
  unrealisedCryptoCents: { gain: number; shortTerm: number; longTerm: number };
  // The 1099-DA for an exchange that sold: collected and how it checked, or still waiting.
  forms1099DA: {
    exchange: string;
    proceedsCents: number;
    status: "matches" | "differs" | "unchecked" | "waiting";
  }[];
  rsu: (RsuResult & { company: string; occurredOn: string; id: string })[];
  // The RSU withholding that falls short, as one figure for the brief and the chat: from this
  // year's vests, or with none known an assumed share of the stock plan (said so). Null: none.
  rsuGap: {
    vestedCents: number;
    shortfallCents: number;
    marginalRate: number;
    assumed: boolean;
    stockCents: number;
  } | null;
  amtCents: number;
  amtPreferenceCents: number;
  setAside: {
    cents: number;
    parts: { label: string; cents: number }[];
    goalName: string;
    goalStarted: boolean;
  };
};

export const setAsideGoalName = (year: number) => `Taxes set aside for equity and crypto ${year}`;

export async function loadEquityTax(
  userId: string,
  {
    client = defaultClient,
    now = new Date(),
    loaded,
  }: Options & { loaded?: { estimate: TaxEstimateView; advice: boolean } } = {},
): Promise<EquityTaxView> {
  // The year the estimate will use is known without it, so what depends only on the year runs
  // together with the estimate instead of after it (each step is a trip to the database).
  const guess = defaultTaxYear(now.toISOString().slice(0, 10));
  const db = scopedFor(userId, client);
  const [estimate, advice, guessedIncome, guessedGoal] = await Promise.all([
    loaded ? loaded.estimate : loadTaxEstimate(userId, { client, now }),
    loaded ? loaded.advice : adviceMode(userId, { client }),
    loadEquityIncome(userId, guess, { client, now }),
    db.savingsGoals.count({ where: { name: setAsideGoalName(guess) } }),
  ]);
  const year = estimate.year;
  const [income, goal] =
    year === guess
      ? [guessedIncome, guessedGoal]
      : await Promise.all([
          loadEquityIncome(userId, year, { client, now }),
          db.savingsGoals.count({ where: { name: setAsideGoalName(year) } }),
        ]);
  // The tax documents are looked up only to check a 1099-DA, so only when an exchange sold.
  const docs =
    income.crypto.exchangesSold.length > 0
      ? await loadTaxDocuments(userId, year, { client, now })
      : { forms: [] as Awaited<ReturnType<typeof loadTaxDocuments>>["forms"] };
  const cryptoYear = totals(income.crypto.yearSales);
  const unrealised = income.crypto.holdings.reduce(
    (a, h) => ({
      gain: a.gain + h.gainCents,
      shortTerm: a.shortTerm + h.shortTermCents,
      longTerm: a.longTerm + h.longTermCents,
    }),
    { gain: 0, shortTerm: 0, longTerm: 0 },
  );
  const forms1099DA = income.crypto.exchangesSold.map((x) => {
    const f = docs.forms.find((d) => d.formKey === "da" && d.from === x.name);
    return {
      exchange: x.name,
      proceedsCents: x.proceedsCents,
      status: f?.document ? (f.check?.status ?? "unchecked") : ("waiting" as const),
    };
  });

  // RSU vests in the year: withholding against the real rate.
  const rsu = income.events
    .filter((e) => e.event.kind === "rsu" && e.event.occurredOn.startsWith(String(year)))
    .map((e) => ({
      ...rsuVest(e.event, estimate.estimate.marginalRate)!,
      company: e.event.company,
      occurredOn: e.event.occurredOn,
      id: e.event.id,
    }));

  // What to set aside: the tax each part adds, none of it withheld.
  const input = estimate.input;
  const tax = (i: typeof input) => estimateTaxes(i).totalTaxCents;
  const parts: { label: string; cents: number }[] = [];
  if (cryptoYear.shortTermCents !== 0 || cryptoYear.longTermCents !== 0) {
    const without = tax({
      ...input,
      income: {
        ...input.income,
        shortTermGainsCents: input.income.shortTermGainsCents - cryptoYear.shortTermCents,
        longTermGainsCents: input.income.longTermGainsCents - cryptoYear.longTermCents,
      },
    });
    parts.push({ label: "Tax on your crypto sales", cents: Math.max(0, tax(input) - without) });
  }
  const eqGains =
    income.shortTermGainsCents +
    income.longTermGainsCents -
    cryptoYear.shortTermCents -
    cryptoYear.longTermCents;
  if (income.ordinaryCents !== 0 || eqGains !== 0) {
    const without = tax({
      ...input,
      income: {
        ...input.income,
        wagesCents: input.income.wagesCents - income.ordinaryCents,
        shortTermGainsCents:
          input.income.shortTermGainsCents -
          (income.shortTermGainsCents - cryptoYear.shortTermCents),
        longTermGainsCents:
          input.income.longTermGainsCents - (income.longTermGainsCents - cryptoYear.longTermCents),
      },
    });
    parts.push({
      label: "Tax on your ESPP and option sales",
      cents: Math.max(0, tax(input) - without),
    });
  }
  if (estimate.estimate.amtCents > 0)
    parts.push({
      label: "Alternative minimum tax on your ISOs",
      cents: estimate.estimate.amtCents,
    });
  const shortfall = rsu.reduce((s, r) => s + r.shortfallCents, 0);
  if (shortfall > 0) parts.push({ label: "RSU withholding that falls short", cents: shortfall });
  const stockCents = (
    await db.accounts.findMany({
      where: { subtype: "stock plan" },
      select: { currentBalanceCents: true },
    })
  ).reduce((a, x) => a + (x.currentBalanceCents ?? 0), 0);
  const rsuGap =
    rsu.length > 0
      ? {
          vestedCents: rsu.reduce((a, r) => a + r.incomeCents, 0),
          shortfallCents: shortfall,
          marginalRate: estimate.estimate.marginalRate,
          assumed: false,
          stockCents,
        }
      : stockCents > 0
        ? {
            ...assumedRsuGap(stockCents, estimate.estimate.marginalRate),
            marginalRate: estimate.estimate.marginalRate,
            assumed: true,
            stockCents,
          }
        : null;
  const nonZero = parts.filter((p) => p.cents > 0);
  return {
    year,
    advice,
    income,
    cryptoYear,
    unrealisedCryptoCents: unrealised,
    forms1099DA,
    rsu,
    rsuGap,
    amtCents: estimate.estimate.amtCents,
    amtPreferenceCents: income.amtPreferenceCents,
    setAside: {
      cents: nonZero.reduce((s, p) => s + p.cents, 0),
      parts: nonZero,
      goalName: setAsideGoalName(year),
      goalStarted: goal > 0,
    },
  };
}

// The set-aside goal: a tracker for the tax these will bring. Demo advice only (it's a
// recommendation of an amount); moves no money.
export async function startSetAside(
  userId: string,
  { client = defaultClient, now = new Date(), via }: Options & { via: "chat" | "page" },
): Promise<EquityTaxView["setAside"]> {
  const view = await loadEquityTax(userId, { client, now });
  if (!view.advice)
    throw new EquityTaxError(
      "Setting an amount aside will come once Jane works with a tax professional.",
    );
  if (view.setAside.goalStarted) throw new EquityTaxError("That goal is already started.");
  if (!worthSettingAside(view.setAside.cents)) {
    throw new EquityTaxError("There isn't enough tax from these to be worth setting aside.");
  }
  await addGoal(
    userId,
    {
      name: view.setAside.goalName,
      target: (view.setAside.cents / 100).toFixed(2),
      targetDate: `${view.year + 1}-04-15`,
      accountId: "",
      saved: "",
    },
    { client },
  );
  await track(userId, "equity_set_aside_started", { via });
  return { ...view.setAside, goalStarted: true };
}

export type EventInput = {
  kind: string;
  company: string;
  shares: number;
  occurredOn: string;
  grantedOn: string | null;
  priceCents: number;
  fmvCents: number;
  withheldCents: number | null;
  soldOn: string | null;
  soldPriceCents: number | null;
  grantDiscountCents: number | null;
};

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const goodDate = (d: string) => DATE.test(d) && !Number.isNaN(Date.parse(d));

// Adds an equity pay event the person told Jane about. Checked here, whatever sent it.
export async function addEquityEvent(
  userId: string,
  input: EventInput,
  { client = defaultClient, now = new Date(), via }: Options & { via: "chat" | "page" },
): Promise<string> {
  if (!Object.hasOwn(EQUITY_EVENT_KINDS, input.kind))
    throw new EquityTaxError("Pick RSUs, ESPP or ISOs.");
  const money = (n: number | null) => n === null || (Number.isInteger(n) && n >= 0);
  if (!input.company.trim()) throw new EquityTaxError("Say which company.");
  if (!(input.shares > 0) || input.shares > 10_000_000)
    throw new EquityTaxError("Give the number of shares.");
  if (!goodDate(input.occurredOn) || input.occurredOn > iso(now)) {
    throw new EquityTaxError("Give the date as a day that has passed.");
  }
  if (input.grantedOn !== null && !goodDate(input.grantedOn))
    throw new EquityTaxError("Give the grant date as YYYY-MM-DD.");
  if (
    !money(input.priceCents) ||
    !money(input.fmvCents) ||
    !money(input.withheldCents) ||
    !money(input.soldPriceCents) ||
    !money(input.grantDiscountCents)
  ) {
    throw new EquityTaxError("Prices must be dollars and cents, none below zero.");
  }
  if (input.fmvCents <= 0) throw new EquityTaxError("Give the market price per share that day.");
  if (input.soldOn !== null) {
    if (!goodDate(input.soldOn) || input.soldOn < input.occurredOn || input.soldOn > iso(now)) {
      throw new EquityTaxError("The sale date must be after the purchase and not in the future.");
    }
    if (input.soldPriceCents === null) throw new EquityTaxError("Give the price you sold at.");
  }
  const at = (d: string | null) => (d ? new Date(`${d}T00:00:00Z`) : null);
  const row = await scopedFor(userId, client).equityEvents.create({
    data: {
      userId,
      kind: input.kind,
      company: input.company.trim().slice(0, 80),
      shares: input.shares,
      occurredOn: at(input.occurredOn)!,
      grantedOn: at(input.grantedOn),
      priceCents: input.priceCents,
      fmvCents: input.fmvCents,
      withheldCents: input.withheldCents,
      soldOn: at(input.soldOn),
      soldPriceCents: input.soldOn ? input.soldPriceCents : null,
      grantDiscountCents: input.grantDiscountCents,
    },
  });
  await logAudit(
    { type: "user", id: userId },
    "tax_profile_changed",
    { type: "user", id: userId },
    { fields: "equityEvent", via },
  );
  await track(userId, "equity_event_added", { kind: input.kind, via });
  return row.id;
}

export async function removeEquityEvent(
  userId: string,
  id: string,
  { client = defaultClient }: Options = {},
): Promise<void> {
  const res = await scopedFor(userId, client).equityEvents.deleteMany({ where: { id } });
  if (res.count === 0) throw new EquityTaxError("That one's already gone.");
}

export { EQUITY_SET_ASIDE_MIN_CENTS, toEvent };
export type { EquityEventKind };
