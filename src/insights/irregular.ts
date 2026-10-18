import { FALLBACK_AMOUNT_TOLERANCE, NEXT_CHARGE_WINDOW_DAYS } from "@/config/detection";
import {
  IRREGULAR_ACTIVE_WITHIN_INTERVALS,
  IRREGULAR_EXCLUDED_ACCOUNT_TYPES,
  IRREGULAR_EXCLUDED_PRIMARIES,
  IRREGULAR_STREAM_FREQUENCIES,
  SEASONAL_MIN_EXTRA_CENTS,
  SEASONAL_MIN_USUAL_MONTHS,
  SEASONAL_SPIKE_RATIO,
  SEASONS,
  SEMIANNUAL_INTERVAL_DAYS,
  SET_ASIDE_ROUNDING_CENTS,
  YEARLY_BILL_CATEGORIES,
  YEARLY_BILL_MIN_CENTS,
  YEARLY_BILL_PHRASES,
  YEARLY_INTERVAL_DAYS,
} from "@/config/irregular";
import { normalizeMerchant } from "@/data-sources/merchant";
import { expectedDates } from "@/detection/forecast";
import { byDate, merchantMatches } from "@/detection/helpers";
import { buildStreams, merchantOf } from "@/detection/streams";
import type { DetectionInput, DetectionTransaction } from "@/detection/types";
import { DAYS_PER_MONTH, addDays, daysBetween, median } from "@/detection/units";
import { monthsEnding } from "./spending";

// Saving for irregular costs (spec step 70): bills that come less often than monthly
// (quarterly, twice a year, yearly) and seasonal spending spikes (holiday gifts), each as
// a monthly amount to set aside. Never anything from loan or investment accounts. Math
// from the person's own data, not a recommendation. Pure.

export type IrregularFrequency = "QUARTERLY" | "SEMIANNUALLY" | "ANNUALLY";

export type IrregularItem = {
  // "merchant:duolingo" for a bill, "season:holiday_gifts" for a seasonal spike.
  key: string;
  name: string;
  kind: "bill" | "seasonal";
  frequency: IrregularFrequency;
  yearlyCents: number;
  // The next expected charge (or the start of the season), and how much it should be.
  nextDate: string;
  nextAmountCents: number;
  // yearly / 12, rounded up to the dollar.
  monthlyCents: number;
  // What setting aside the monthly amount since the last one would have put by today.
  byNowCents: number;
};

export type IrregularCosts = {
  items: IrregularItem[];
  monthlyCents: number;
  yearlyCents: number;
};

const TIMES_A_YEAR: Record<IrregularFrequency, number> = {
  QUARTERLY: 4,
  SEMIANNUALLY: 2,
  ANNUALLY: 1,
};

function addMonths(date: string, months: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const out = new Date(Date.UTC(y, m - 1 + months, 1));
  const last = new Date(Date.UTC(out.getUTCFullYear(), out.getUTCMonth() + 1, 0)).getUTCDate();
  out.setUTCDate(Math.min(d, last));
  return out.toISOString().slice(0, 10);
}

export function monthlySetAside(yearlyCents: number): number {
  return Math.ceil(yearlyCents / 12 / SET_ASIDE_ROUNDING_CENTS) * SET_ASIDE_ROUNDING_CENTS;
}

function item(
  base: Pick<IrregularItem, "key" | "name" | "kind" | "frequency" | "nextAmountCents">,
  nextDate: string,
  asOf: string,
): IrregularItem {
  const yearlyCents = base.nextAmountCents * TIMES_A_YEAR[base.frequency];
  const cycleDays = (12 / TIMES_A_YEAR[base.frequency]) * DAYS_PER_MONTH;
  const share = Math.min(1, Math.max(0, 1 - daysBetween(asOf, nextDate) / cycleDays));
  return {
    ...base,
    yearlyCents,
    nextDate,
    monthlyCents: monthlySetAside(yearlyCents),
    byNowCents: Math.round(base.nextAmountCents * share),
  };
}

const excludedAccounts = (input: DetectionInput) =>
  new Set(
    input.accounts
      .filter((a) => IRREGULAR_EXCLUDED_ACCOUNT_TYPES.includes(a.type))
      .map((a) => a.id),
  );

// Outflows that could be a bill to set aside for: not on a loan or investment account,
// not money moving between accounts, a loan payment or income.
function eligible(input: DetectionInput): DetectionTransaction[] {
  const excluded = excludedAccounts(input);
  return input.transactions.filter(
    (t) =>
      t.amountCents > 0 &&
      !excluded.has(t.accountId) &&
      !IRREGULAR_EXCLUDED_PRIMARIES.includes(t.pfcPrimary ?? ""),
  );
}

// Quarterly and yearly streams, from Plaid or our own stream detection.
function fromStreams(input: DetectionInput, transactions: DetectionTransaction[]) {
  const excluded = excludedAccounts(input);
  const streams = buildStreams({
    ...input,
    transactions,
    recurringStreams: input.recurringStreams.filter((s) => !excluded.has(s.accountId)),
  });
  const until = addDays(input.asOf, NEXT_CHARGE_WINDOW_DAYS);
  const items = streams.flatMap((s) => {
    if (!s.active || !s.frequency || !IRREGULAR_STREAM_FREQUENCIES.includes(s.frequency)) return [];
    if (IRREGULAR_EXCLUDED_PRIMARIES.includes(s.pfcPrimary ?? "")) return [];
    if (s.accountId !== null && excluded.has(s.accountId)) return [];
    const next = expectedDates(s, input.asOf, until)[0];
    if (!next) return [];
    return [
      item(
        {
          key: s.key,
          name: s.merchant,
          kind: "bill",
          frequency: s.frequency as IrregularFrequency,
          nextAmountCents: s.lastAmountCents,
        },
        next,
        input.asOf,
      ),
    ];
  });
  return { items, merchantKeys: new Set(streams.map((s) => s.merchantKey)) };
}

const inRange = (gap: number, [min, max]: readonly [number, number]) => gap >= min && gap <= max;

// Twice-a-year and yearly bills our stream detection doesn't look for: 2+ charges at a
// merchant at that gap, or (with only a year of data) one charge of the yearly kind.
function fromPatterns(
  input: DetectionInput,
  transactions: DetectionTransaction[],
  skip: Set<string>,
): IrregularItem[] {
  const groups = new Map<string, { name: string; charges: DetectionTransaction[] }>();
  for (const t of transactions) {
    const merchant = merchantOf(t);
    if (!merchant || skip.has(merchant.key)) continue;
    const group = groups.get(merchant.key) ?? {
      name: t.merchantName ?? merchant.name,
      charges: [],
    };
    group.charges.push(t);
    groups.set(merchant.key, group);
  }
  return [...groups.keys()].sort().flatMap((key) => {
    const { name, charges } = groups.get(key)!;
    charges.sort(byDate);
    const last = charges[charges.length - 1];

    if (charges.length === 1) {
      // The words can be in the merchant's name or the bank's description.
      const words = `${key} ${normalizeMerchant(last.description)?.key ?? ""}`;
      const yearlyKind =
        YEARLY_BILL_CATEGORIES.includes(last.pfcDetailed ?? "") ||
        merchantMatches(words, YEARLY_BILL_PHRASES);
      const next = addMonths(last.date, 12);
      if (!yearlyKind || last.amountCents < YEARLY_BILL_MIN_CENTS || next < input.asOf) return [];
      const base = { key: `merchant:${key}`, name, kind: "bill" as const };
      return [
        item(
          { ...base, frequency: "ANNUALLY", nextAmountCents: last.amountCents },
          next,
          input.asOf,
        ),
      ];
    }

    const typical = median(charges.map((c) => c.amountCents));
    const core = charges.filter(
      (c) => Math.abs(c.amountCents - typical) <= typical * FALLBACK_AMOUNT_TOLERANCE,
    );
    if (core.length < 2 || core.length !== charges.length) return [];
    const gaps = core.slice(1).map((c, i) => daysBetween(core[i].date, c.date));
    const frequency: IrregularFrequency | null = gaps.every((g) =>
      inRange(g, SEMIANNUAL_INTERVAL_DAYS),
    )
      ? "SEMIANNUALLY"
      : gaps.every((g) => inRange(g, YEARLY_INTERVAL_DAYS))
        ? "ANNUALLY"
        : null;
    if (!frequency) return [];
    if (daysBetween(last.date, input.asOf) > median(gaps) * IRREGULAR_ACTIVE_WITHIN_INTERVALS) {
      return [];
    }
    let next = addMonths(last.date, 12 / TIMES_A_YEAR[frequency]);
    if (next < input.asOf) next = input.asOf;
    return [
      item(
        {
          key: `merchant:${key}`,
          name,
          kind: "bill",
          frequency,
          nextAmountCents: last.amountCents,
        },
        next,
        input.asOf,
      ),
    ];
  });
}

// Seasonal spikes: a season month's spending in the season's categories, above the
// category's usual month (the median of the other complete months we have data for).
function fromSeasons(input: DetectionInput, transactions: DetectionTransaction[]) {
  const dates = input.transactions.map((t) => t.date.slice(0, 7)).sort();
  if (dates.length === 0) return [];
  const thisMonth = input.asOf.slice(0, 7);
  // The 12 complete months before this one that we have data for.
  const months = monthsEnding(input.asOf, 13)
    .slice(0, -1)
    .filter((m) => m >= dates[0] && m <= dates[dates.length - 1]);
  return SEASONS.flatMap((season) => {
    const totals = new Map(months.map((m) => [m, 0]));
    for (const t of transactions) {
      const month = t.date.slice(0, 7);
      if (totals.has(month) && season.primaries.includes(t.pfcPrimary ?? "")) {
        totals.set(month, (totals.get(month) ?? 0) + t.amountCents);
      }
    }
    const inSeason = (m: string) => season.months.includes(Number(m.slice(5, 7)));
    const usualMonths = months.filter((m) => !inSeason(m)).map((m) => totals.get(m) ?? 0);
    if (usualMonths.length < SEASONAL_MIN_USUAL_MONTHS) return [];
    const usual = median(usualMonths);
    const extra = months
      .filter(inSeason)
      .map((m) => totals.get(m) ?? 0)
      .filter((total) => total >= usual * SEASONAL_SPIKE_RATIO)
      .reduce((sum, total) => sum + Math.round(total - usual), 0);
    if (extra < SEASONAL_MIN_EXTRA_CENTS) return [];

    // The first day of the next season month, or today while the season is on.
    const upcoming = monthsEnding(addMonths(input.asOf, 11), 12).find(inSeason) ?? thisMonth;
    const next = upcoming === thisMonth ? input.asOf : `${upcoming}-01`;
    return [
      item(
        {
          key: `season:${season.key}`,
          name: season.name,
          kind: "seasonal",
          frequency: "ANNUALLY",
          nextAmountCents: extra,
        },
        next,
        input.asOf,
      ),
    ];
  });
}

export function irregularCosts(input: DetectionInput): IrregularCosts {
  const transactions = eligible(input);
  const streams = fromStreams(input, transactions);
  const items = [
    ...streams.items,
    ...fromPatterns(input, transactions, streams.merchantKeys),
    ...fromSeasons(input, transactions),
  ].sort((a, b) => a.nextDate.localeCompare(b.nextDate) || a.key.localeCompare(b.key));
  return {
    items,
    monthlyCents: items.reduce((sum, i) => sum + i.monthlyCents, 0),
    yearlyCents: items.reduce((sum, i) => sum + i.yearlyCents, 0),
  };
}
