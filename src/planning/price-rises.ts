import {
  ANNUAL_CONFIDENCE_CAP,
  ANNUAL_MIN_AGE_DAYS,
  CALL_SCRIPTS,
  PRICE_RISE_WINDOW_DAYS,
  PROMO_CATEGORIES,
  PROMO_CONFIDENCE_CAP,
  PROMO_FLAT_CENTS,
  PROMO_MIN_CHARGES,
  PROMO_MONTHS,
  PROMO_NEW_AFTER_DAYS,
  PROMO_RISE_SHARE,
} from "@/config/price-rises";
import { isYearlyPlanCharge } from "@/detection/streams";
import { confidenceOf } from "@/profile/confidence";
import { DAY_MS } from "@/lib/dates";

// Price rises seen before they land (spec step 243). Pure: the person's charges in, the
// introductory prices about to end and the yearly plans about to renew out, each with its date,
// what it costs now and after, the cheaper choice and what to say on the call.

export type Charge = {
  date: string;
  // Positive for money out.
  amountCents: number;
  description: string;
  pfc: string | null;
  // The company's name as the rest of the app says it (the merchant directory's, or the cleaned
  // bank name). Without one, the payee is read from the description (payeeOf).
  merchantName?: string | null;
};

export type PriceRise = {
  // Stable for the rise: "promo:<name>:<date>" or "annual:<name>:<date>".
  key: string;
  kind: "promo_end" | "annual_renewal";
  name: string;
  // The day the higher price (or the renewal) is expected.
  date: string;
  daysLeft: number;
  nowCents: number;
  // What it will likely cost then: the intro price's usual rise, or the same again.
  thenCents: number;
  // A year of the difference (promo) or the renewal itself (annual).
  atStakeCents: number;
  // The charge it is worked out from (the latest), so the chat can find it.
  chargedOn: string;
  cheaper: string;
  script: string;
  confidence: { percent: number; reason: string };
};

const dayOf = (iso: string) => Date.parse(`${iso}T00:00:00Z`);
const days = (from: string, to: string) => Math.round((dayOf(to) - dayOf(from)) / DAY_MS);
const plusMonths = (date: string, months: number) => {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1 + months, d)).toISOString().slice(0, 10);
};
const plusDays = (date: string, n: number) =>
  new Date(dayOf(date) + n * DAY_MS).toISOString().slice(0, 10);

// "AT&T FIBER 5521" as "At&t Fiber": the payee without its reference numbers.
export const payeeOf = (description: string) =>
  description
    .replace(/[#*].*$/, "")
    .replace(/\b\d{3,}\b/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase()
    .replace(/\b([a-z])/g, (c) => c.toUpperCase())
    // "At&T" is AT&T.
    .replace(/\b(\w{1,2})&(\w{1,2})\b/g, (m) => m.toUpperCase());

function byPayee(charges: readonly Charge[]) {
  const groups = new Map<string, Charge[]>();
  for (const c of charges) {
    if (c.amountCents <= 0) continue;
    const name = c.merchantName || payeeOf(c.description);
    groups.set(name, [...(groups.get(name) ?? []), c]);
  }
  for (const list of groups.values()) list.sort((a, b) => a.date.localeCompare(b.date));
  return groups;
}

export function priceRises(charges: readonly Charge[], today: string): PriceRise[] {
  if (charges.length === 0) return [];
  const dataStart = charges.reduce((m, c) => (c.date < m ? c.date : m), charges[0].date);
  const months = Math.max(1, Math.round(days(dataStart, today) / 30));
  const out: PriceRise[] = [];
  for (const [name, list] of byPayee(charges)) {
    const first = list[0];
    const last = list[list.length - 1];
    // An introductory price: a new internet or phone bill whose price hasn't moved.
    if (PROMO_CATEGORIES.includes(first.pfc ?? "") && list.length >= PROMO_MIN_CHARGES) {
      const amounts = list.map((c) => c.amountCents);
      const flat = Math.max(...amounts) - Math.min(...amounts) <= PROMO_FLAT_CENTS;
      const isNew = days(dataStart, first.date) >= PROMO_NEW_AFTER_DAYS;
      const ends = PROMO_MONTHS.map((m) => plusMonths(first.date, m)).find((d) => d >= today);
      if (flat && isNew && ends && days(today, ends) <= PRICE_RISE_WINDOW_DAYS) {
        const then = Math.round(last.amountCents * (1 + PROMO_RISE_SHARE));
        const seen = confidenceOf("seen", { months, matches: list.length });
        out.push({
          key: `promo:${name}:${ends}`,
          kind: "promo_end",
          name,
          date: ends,
          daysLeft: days(today, ends),
          nowCents: last.amountCents,
          thenCents: then,
          atStakeCents: (then - last.amountCents) * 12,
          chargedOn: last.date,
          cheaper: `Call before ${ends} and ask to keep your price, or switch: new-customer prices elsewhere are often what you pay now.`,
          script: CALL_SCRIPTS.promo_end,
          confidence: {
            percent: Math.min(seen, PROMO_CONFIDENCE_CAP),
            reason: `${list.length} charges at the same price since ${first.date}; intro prices usually last ${PROMO_MONTHS[0]} months`,
          },
        });
      }
    }
    // A yearly plan: one charge about a year ago that is a plan's by detection's own rule (its
    // name or its words), never by its category alone: a movie ticket (AMC, not AMC+) or a
    // bookstore receipt was taken for a yearly plan (founder's live /deadlines, 10-29).
    if (
      list.length === 1 &&
      isYearlyPlanCharge({
        amountCents: first.amountCents,
        description: first.description,
        merchantName: first.merchantName ?? null,
      })
    ) {
      const age = days(first.date, today);
      const renews = plusDays(first.date, 365);
      if (age >= ANNUAL_MIN_AGE_DAYS && renews >= today) {
        out.push({
          key: `annual:${name}:${renews}`,
          kind: "annual_renewal",
          name,
          date: renews,
          daysLeft: days(today, renews),
          nowCents: first.amountCents,
          thenCents: first.amountCents,
          atStakeCents: first.amountCents,
          chargedOn: first.date,
          cheaper: `Decide before ${renews}: keep it, move to a monthly or cheaper plan, or turn off auto-renewal.`,
          script: CALL_SCRIPTS.annual_renewal,
          confidence: {
            percent: Math.min(confidenceOf("seen", { months, matches: 1 }), ANNUAL_CONFIDENCE_CAP),
            reason: `one ${name} charge on ${first.date}, about a year ago`,
          },
        });
      }
    }
  }
  return out.sort((a, b) => a.date.localeCompare(b.date) || a.key.localeCompare(b.key));
}
