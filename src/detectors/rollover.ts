import { ROLLOVER_CLOCK } from "@/config/retirement";
import { formatCents } from "@/lib/money";
import { type Detector, suggestion } from "./contract";
import { evidence, headlineOf, tx } from "./helpers";
import { addDays } from "@/lib/dates";
import { dayLabel } from "@/lib/day-label";

// A payout from a retirement plan or IRA landed in the bank (connectors roadmap round 17,
// rollover_60_day_clock): it can still be rolled over if it goes into an IRA or plan within 60
// days of being received. Facts and a date only: whether to roll it over, and where, is the
// person's. Pure; see ./contract.ts.

const DAY = 86_400_000;
const daysBetween = (from: string, to: string) =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY);
const longDate = (day: string) => dayLabel(day, { long: true, year: true });

// Payouts the tax rules do not let anyone roll over: required minimum distributions and hardship
// withdrawals. Anything not named like these may or may not be eligible; the card says so.
const CANNOT_ROLL_OVER = /\b(?:required minimum|rmd|hardship)\b/i;

const rolloverClock: Detector = {
  capability: "investing",
  topic: "rollover_clock",
  covers: [],
  needs: [],
  detect({ profile, data }) {
    // Money in (Plaid's sign: negative), big enough, naming a plan or IRA and a payout, with days
    // left on its clock. The latest one, if there are several.
    const payouts = tx(data, (t) => {
      const words = `${t.description} ${t.merchantName ?? ""}`;
      const left = ROLLOVER_CLOCK.days - daysBetween(t.date, data.today);
      return (
        t.amountCents <= -ROLLOVER_CLOCK.minCents &&
        ROLLOVER_CLOCK.plan.test(words) &&
        ROLLOVER_CLOCK.payout.test(words) &&
        !CANNOT_ROLL_OVER.test(words) &&
        left >= 0 &&
        left <= ROLLOVER_CLOCK.days
      );
    }).sort((a, b) => b.date.localeCompare(a.date));
    // A payout that comes again and again (a retiree's monthly IRA draw) is income, not a one-off
    // to roll over: the same words on another date and about the same amount rule it out. The same
    // words with a different amount are another payout (two old plans, each paying out once).
    const words = (d: string) => d.replace(/\d+/g, "").replace(/\s+/g, " ").trim().toLowerCase();
    const regular = (p: (typeof payouts)[number]) =>
      data.transactions.some(
        (t) =>
          t !== p &&
          t.amountCents < 0 &&
          t.date !== p.date &&
          words(t.description) === words(p.description) &&
          Math.abs(t.amountCents - p.amountCents) <=
            Math.max(Math.abs(t.amountCents), Math.abs(p.amountCents)) * 0.25,
      );
    const payout = payouts.find((p) => !regular(p));
    if (!payout) return null;
    const amount = -payout.amountCents;
    const by = addDays(payout.date, ROLLOVER_CLOCK.days);
    const left = daysBetween(data.today, by);
    // If a plan withheld 20%, what arrived is 80% of the payout.
    const withheld = Math.round(
      (amount / (1 - ROLLOVER_CLOCK.planWithholdingShare)) * ROLLOVER_CLOCK.planWithholdingShare,
    );
    return suggestion("investing", "rollover_clock", {
      title: `A ${formatCents(amount)} retirement payout can still be rolled over until ${longDate(by)}`,
      headline: headlineOf("Note the 60-day rollover date", amount, "risk"),
      short: `${formatCents(amount)} from a retirement plan or IRA arrived on ${longDate(payout.date)}; ${left} days left to roll it over.`,
      worthCents: amount,
      worthKind: "risk",
      confidence: evidence("seen", profile.months, 1, "one-off retirement payouts"),
      urgency: left <= ROLLOVER_CLOCK.urgentDays ? "now" : "soon",
      why: `${formatCents(amount)} arrived on ${longDate(payout.date)} from what looks like a retirement plan or IRA payout. A payout that can be rolled over at all (a required minimum distribution, for one, can't) can still be if it goes into an IRA or plan within ${ROLLOVER_CLOCK.days} days of getting it, here by ${longDate(by)}; after that it counts as income for the year, and before 59½ it can cost 10% more. A plan usually withholds 20% from a payout like this (about ${formatCents(withheld)} if it did); rolling over the whole payout means adding that much from other money. If this was already a rollover, or isn't a payout, nothing to do.`,
      action: { label: "See your retirement accounts", href: "/investments" },
      more: [{ label: "The IRS's rollover rules", href: ROLLOVER_CLOCK.source }],
    });
  },
};

export const ROLLOVER_DETECTORS: readonly Detector[] = [rolloverClock];
