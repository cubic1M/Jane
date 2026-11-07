import { ROLLOVER_CLOCK } from "@/config/retirement";
import { formatCents } from "@/lib/money";
import { type Detector, suggestionId } from "./contract";
import { evidence, headlineOf, tx } from "./helpers";

// A payout from a retirement plan or IRA landed in the bank (connectors roadmap round 17,
// rollover_60_day_clock): it can still be rolled over if it goes into an IRA or plan within 60
// days of being received. Facts and a date only: whether to roll it over, and where, is the
// person's. Pure; see ./contract.ts.

const DAY = 86_400_000;
const addDays = (day: string, n: number) =>
  new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);
const daysBetween = (from: string, to: string) =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY);
const longDate = (day: string) =>
  new Date(`${day}T00:00:00Z`).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });

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
        left >= 0 &&
        left <= ROLLOVER_CLOCK.days
      );
    }).sort((a, b) => b.date.localeCompare(a.date));
    // A payout that comes again and again (a retiree's monthly IRA draw) is income, not a one-off
    // to roll over: the same words on another date rule it out.
    const words = (d: string) => d.replace(/\d+/g, "").replace(/\s+/g, " ").trim().toLowerCase();
    const regular = (p: (typeof payouts)[number]) =>
      data.transactions.some(
        (t) =>
          t !== p &&
          t.amountCents < 0 &&
          t.date !== p.date &&
          words(t.description) === words(p.description),
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
    return {
      id: suggestionId("investing", "rollover_clock"),
      capability: "investing",
      topic: "rollover_clock",
      title: `A ${formatCents(amount)} retirement payout can still be rolled over until ${longDate(by)}`,
      headline: headlineOf("Note the 60-day rollover date", amount, "risk"),
      short: `${formatCents(amount)} from a retirement plan or IRA arrived on ${longDate(payout.date)}; ${left} days left to roll it over.`,
      worthCents: amount,
      worthKind: "risk",
      confidence: evidence("seen", profile.months, 1, "one-off retirement payouts"),
      urgency: left <= ROLLOVER_CLOCK.urgentDays ? "now" : "soon",
      why: `${formatCents(amount)} arrived on ${longDate(payout.date)} from what looks like a retirement plan or IRA payout. A payout can still be rolled over if it goes into an IRA or plan within ${ROLLOVER_CLOCK.days} days of getting it, here by ${longDate(by)}; after that it counts as income for the year, and before 59½ it can cost 10% more. A plan usually withholds 20% from a payout like this (about ${formatCents(withheld)} if it did); rolling over the whole payout means adding that much from other money. If this was already a rollover, or isn't a payout, nothing to do.`,
      action: { label: "See your retirement accounts", href: "/investments" },
      more: [{ label: "The IRS's rollover rules", href: ROLLOVER_CLOCK.source }],
    };
  },
};

export const ROLLOVER_DETECTORS: readonly Detector[] = [rolloverClock];
