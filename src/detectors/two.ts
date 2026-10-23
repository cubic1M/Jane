import { SHARED_BILL_PRIMARY, SPLIT_INCOME_DAYS, WAGE_CATEGORIES } from "@/config/money-for-two";
import { formatCents } from "@/lib/money";
import { HALF, incomeSplitMatters, partnerShareBps, twoEarners } from "@/planning/money-for-two";
import { type Detector, suggestionId } from "./contract";
import { dollars, evidence, tx } from "./helpers";

// Money for two (spec step 242), brought to the person unasked: two people's pay lands in the
// accounts Jane sees, it differs a lot, and they haven't chosen how shared bills split. Pure;
// see ./contract.ts.

const DAY_MS = 86_400_000;
const before = (day: string, days: number) =>
  new Date(Date.parse(`${day}T00:00:00Z`) - days * DAY_MS).toISOString().slice(0, 10);

const billSplit: Detector = {
  covers: ["money_for_two"],
  capability: "two",
  topic: "bill_split",
  needs: [],
  detect({ profile, data }) {
    if (data.extras?.splitChosen) return null;
    const since = before(profile.today, SPLIT_INCOME_DAYS);
    const pay = tx(
      data,
      (t) => t.amountCents < 0 && t.date > since && WAGE_CATEGORIES.includes(t.pfc ?? ""),
    );
    const earners = twoEarners(
      pay.map((t) => ({ description: t.description, cents: -t.amountCents })),
    );
    if (!earners) return null;
    // The second earner's share of what the two earn.
    const secondShare = partnerShareBps("income", earners.first.cents, earners.second.cents);
    if (!incomeSplitMatters(secondShare)) return null;
    const yearAgo = before(profile.today, 365);
    const bills = tx(
      data,
      (t) =>
        t.amountCents > 0 &&
        t.date > yearAgo &&
        SHARED_BILL_PRIMARY.some((p) => (t.pfc ?? "").startsWith(p)) &&
        t.pfc !== "LOAN_PAYMENTS_CREDIT_CARD_PAYMENT",
    ).reduce((s, t) => s + t.amountCents, 0);
    const moves = Math.round((bills * Math.abs(secondShare - HALF)) / 10_000);
    const first = Math.round((10_000 - secondShare) / 100);
    const nice = (s: string) => s.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
    return {
      id: suggestionId("two", "bill_split"),
      capability: "two",
      topic: "bill_split",
      title: "Choose how you two split shared bills: half each, or by what each earns",
      headline: `Set bills to ${first}/${100 - first} by income: ${dollars(moves)}/yr`,
      short: `${nice(earners.first.name)} pays ${first}% of what you two earn; bills now split half each.`,
      worthCents: moves,
      worthKind: "risk",
      confidence: evidence("seen", Math.max(profile.months, 1), pay.length, "paycheck"),
      urgency: "later",
      why: `Two paychecks land here: ${nice(earners.first.name)} pays ${first}% of what you two earn and ${nice(earners.second.name)} ${100 - first}%. Split by income, about ${formatCents(moves)} a year of your ${formatCents(bills)} in shared bills moves from one of you to the other. Either way works; invite your partner and choose together.`,
      action: { label: "Choose how to split", href: "/household#money-for-two" },
    };
  },
};

export const TWO_DETECTORS: readonly Detector[] = [billSplit];
