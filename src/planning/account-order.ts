import { FUND_FACTS } from "@/config/funds";
import {
  EARLY_WITHDRAWAL_PENALTY,
  GOALS,
  HORIZONS,
  MIN_TAX_DRAG_CENTS,
  QUALIFIED_DIVIDEND_RATE,
  ROTH_UP_TO_RATE,
  SOON_HORIZONS,
  TRADITIONAL_FROM_RATE,
  type Goal,
  type Horizon,
} from "@/config/investing";
import {
  EMPLOYEE_DEFERRAL_LIMIT_CENTS,
  IRA_CATCH_UP_CENTS,
  IRA_LIMIT_CENTS,
} from "@/config/retirement";
import { TAXABLE_INVESTMENT_SUBTYPES } from "@/config/tax";
import { CONTRIBUTION_LIMITS } from "@/config/tax-rates";
import type { HoldingView, InvestmentAccountView } from "@/insights/investments";
import { formatWholeDollars as dollars } from "@/lib/money";

// The right account for each dollar (spec step 135, demo advice). Pure.
// - The order to fill accounts in, each step with how much room it has and why, changing
//   with the profile: money needed soon for something other than retirement goes into a
//   flexible account right after the match.
// - Asset location: holdings in a taxable account that pay out a lot (bond interest,
//   dividend funds) cost tax every year; they're better held in a tax-deferred account.
// - The tax view of taxable holdings: gains and losses not yet realised, from cost basis.

export type AccountStep = {
  key: "match" | "hsa" | "ira" | "workplace" | "taxable" | "flexible";
  title: string;
  // A few words, for a sentence ("the 401(k) match").
  short: string;
  // Yearly room, when there's a limit.
  roomCents: number | null;
  why: string;
};

export type OrderInput = {
  age: number;
  horizon: Horizon;
  goals: Goal[];
  // The marginal federal rate from the tax estimate, or null when it isn't known.
  marginalRate: number | null;
  // From the retirement plan (step 132): null without a workplace plan Jane knows.
  match: {
    captured: boolean;
    missedCents: number;
    fullMatchRate: number;
    employeeRate: number;
  } | null;
  employeeCents: number;
  catchUpCents: number;
  hasHsa: boolean;
};

const pct = (rate: number) => `${Math.round(rate * 1000) / 10}%`;

export function rothOrTraditionalByRate(
  rate: number | null,
): "roth" | "traditional" | "mix" | null {
  if (rate === null) return null;
  if (rate <= ROTH_UP_TO_RATE) return "roth";
  if (rate >= TRADITIONAL_FROM_RATE) return "traditional";
  return "mix";
}

const IRA_KIND = {
  roth: "a Roth IRA",
  traditional: "a traditional IRA",
  mix: "a Roth IRA",
} as const;

export function accountOrder(input: OrderInput): AccountStep[] {
  const steps: AccountStep[] = [];
  const soon = SOON_HORIZONS.includes(input.horizon) && !input.goals.includes("retirement");
  if (input.match) {
    steps.push({
      key: "match",
      short: "the 401(k) match",
      title: `Your 401(k), up to the full match (${pct(input.match.fullMatchRate)} of pay)`,
      roomCents: null,
      why: input.match.captured
        ? "You already get all of it: keep it that way. It's an instant return no investment can match."
        : `You put in ${pct(input.match.employeeRate)}; the rest of the match is about ${dollars(input.match.missedCents)} a year of free money.`,
    });
  }
  if (soon) {
    steps.push({
      key: "flexible",
      short: input.goals.includes("education") ? "a 529 or a taxable account" : "a taxable account",
      title: input.goals.includes("education")
        ? "A 529 college savings plan, or a taxable account"
        : "A taxable account (or savings), for money you'll need soon",
      roomCents: null,
      why: `You'll need this money ${HORIZONS[input.horizon].label.toLowerCase()}, for ${input.goals.map((g) => GOALS[g].toLowerCase()).join(" and ")}. Retirement accounts charge a ${EARLY_WITHDRAWAL_PENALTY * 100}% penalty if you take money out before 59½.`,
    });
  }
  const hsaRoom =
    CONTRIBUTION_LIMITS.hsaSelf + (input.age >= 55 ? CONTRIBUTION_LIMITS.hsaCatchUp55 : 0);
  steps.push({
    key: "hsa",
    short: "an HSA",
    title: input.hasHsa ? "Your HSA" : "An HSA, if your health plan has a high deductible",
    roomCents: hsaRoom,
    why: "Money goes in before tax, grows tax-free and comes out tax-free for health costs: the only account that's tax-free all three ways.",
  });
  const kind = rothOrTraditionalByRate(input.marginalRate);
  const iraRoom = IRA_LIMIT_CENTS + (input.age >= 50 ? IRA_CATCH_UP_CENTS : 0);
  steps.push({
    key: "ira",
    short: kind ? IRA_KIND[kind] : "an IRA",
    title: `${kind ? IRA_KIND[kind].charAt(0).toUpperCase() + IRA_KIND[kind].slice(1) : "An IRA"}`,
    roomCents: iraRoom,
    why:
      kind === null
        ? "More choice of funds than most workplace plans. Roth or traditional depends on your tax bracket."
        : kind === "traditional"
          ? `Your top federal rate is about ${pct(input.marginalRate!)}, so the deduction now is worth more than tax-free withdrawals later.`
          : kind === "roth"
            ? `Your top federal rate is about ${pct(input.marginalRate!)}, so paying the tax now and taking it out tax-free later usually comes out ahead.`
            : `Your top federal rate is about ${pct(input.marginalRate!)}, in the middle: with your 401(k) taxed later, a Roth IRA taxed now gives you both kinds of money to draw on in retirement.`,
  });
  steps.push({
    key: "workplace",
    short: "the rest of your 401(k)",
    title: "Back to your 401(k), up to the limit",
    roomCents: Math.max(
      0,
      EMPLOYEE_DEFERRAL_LIMIT_CENTS + input.catchUpCents - input.employeeCents,
    ),
    why: "Still taxed less than a regular account, and it comes straight from your pay.",
  });
  if (!soon) {
    steps.push({
      key: "taxable",
      short: "a taxable account",
      title: "A taxable account for the rest",
      roomCents: null,
      why: "No limits and you can take money out any time; hold broad stock index funds here, which pay out little to tax.",
    });
  }
  return steps;
}

export type LocationMove = {
  holding: HoldingView;
  accountName: string;
  // What its payouts cost in tax a year, held where it is.
  taxDragCents: number;
  better: string;
  why: string;
};

const isTaxable = (subtype: string | null) =>
  TAXABLE_INVESTMENT_SUBTYPES.includes((subtype ?? "").toLowerCase());

// The yearly tax on a holding's payouts in a taxable account: interest at the marginal
// rate, dividends at the qualified rate.
export function taxDrag(h: HoldingView, marginalRate: number): number {
  const facts = h.ticker ? FUND_FACTS[h.ticker.toUpperCase()] : undefined;
  if (!facts?.yieldBps) return 0;
  const rate = facts.interest ? marginalRate : QUALIFIED_DIVIDEND_RATE;
  return Math.round((h.valueCents * facts.yieldBps * rate) / 10_000);
}

export function assetLocation(
  accounts: InvestmentAccountView[],
  marginalRate: number | null,
): LocationMove[] {
  const taxDeferred = accounts.find((a) => a.kind === "retirement");
  if (!taxDeferred) return [];
  const rate = marginalRate ?? 0.22;
  return accounts
    .filter((a) => isTaxable(a.subtype))
    .flatMap((a) =>
      a.holdings
        .filter((h) => !h.isCash)
        .map((h) => ({
          h,
          drag: taxDrag(h, rate),
          facts: h.ticker ? FUND_FACTS[h.ticker.toUpperCase()] : undefined,
        }))
        .filter(({ drag }) => drag >= MIN_TAX_DRAG_CENTS)
        .map(({ h, drag, facts }): LocationMove => ({
          holding: h,
          accountName: a.name,
          taxDragCents: drag,
          better: `your ${taxDeferred.name}`,
          why: `It pays out about ${((facts?.yieldBps ?? 0) / 100).toFixed(1)}% a year in ${facts?.interest ? "interest, taxed like pay" : "dividends"}, about ${dollars(drag)} a year in tax where it is. In your ${taxDeferred.name} that grows untaxed; hold broad stock index funds in ${a.name} instead.`,
        })),
    )
    .sort((x, y) => y.taxDragCents - x.taxDragCents);
}

export type GainsView = {
  gainsCents: number;
  lossesCents: number;
  // Holdings with a loss, biggest first.
  losers: { name: string; accountName: string; lossCents: number }[];
};

// Gains and losses not yet realised in taxable accounts, from each holding's cost basis.
export function unrealisedGains(accounts: InvestmentAccountView[]): GainsView {
  let gains = 0;
  let losses = 0;
  const losers: GainsView["losers"] = [];
  for (const a of accounts.filter((x) => isTaxable(x.subtype))) {
    for (const h of a.holdings) {
      if (h.gainCents === null) continue;
      if (h.gainCents >= 0) gains += h.gainCents;
      else {
        losses += -h.gainCents;
        losers.push({ name: h.name, accountName: a.name, lossCents: -h.gainCents });
      }
    }
  }
  return {
    gainsCents: gains,
    lossesCents: losses,
    losers: losers.sort((x, y) => y.lossCents - x.lossCents),
  };
}
