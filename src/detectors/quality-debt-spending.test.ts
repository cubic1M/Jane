import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));

import { PEOPLE } from "@/config/people";
import { mergeOverlaps, rankSuggestions } from "@/planning/suggestion-rank";
import { buildProfile, type ProfileInput } from "@/profile/build";
import { inputFor } from "@/profile/sample";
import { runDetectors } from "./index";

// Spec step 266 prep: the quality of what the debt and spending detectors say, judged as a
// skeptical customer would. Wording and ranges are pinned here; the verdicts are in
// docs/detectors/review-debt-spending.md.

const run = (id: string, change: (d: ProfileInput) => ProfileInput = (d) => d) => {
  const data = change(inputFor(id));
  return runDetectors({ profile: buildProfile(data), data });
};
const ranked = (id: string) => rankSuggestions(run(id)).map((r) => r.suggestion);
const mine = (topics: readonly string[], list: ReturnType<typeof run>) =>
  list.filter((s) => topics.includes(s.topic));

describe("the debt plan", () => {
  it("speaks of the interest alone when no card is linked (QA: 'Your cards hold $0.00')", () => {
    const noCards = (d: ProfileInput) => ({
      ...d,
      accounts: d.accounts.filter((a) => a.type !== "credit"),
    });
    const plan = run("debt", noCards).find((s) => s.topic === "debt_plan");
    expect(plan).toBeDefined();
    expect(plan!.short).toMatch(/^Your debts cost you \$/);
    expect(plan!.why).toMatch(/^Your debts cost you \$[\d,.]+ in interest a year\.$/);
    expect(`${plan!.short} ${plan!.why}`).not.toContain("cards hold");
    expect(plan!.confidence.percent).toBeGreaterThan(0);
  });

  it("names the card balance when cards are linked", () => {
    const plan = run("debt").find((s) => s.topic === "debt_plan");
    expect(plan!.short).toMatch(/^Your cards hold \$[\d,.]+ and cost you \$/);
  });
});

describe("ranking for the person's life", () => {
  it("puts a plan and relief ahead of tips for Chris, who is in debt trouble", () => {
    // What Chris is shown: suggestions on the same money count once, so the card tips go
    // into the debt plan, and his top three are the plan, the payday loan and his shortfall.
    const shown = mergeOverlaps(rankSuggestions(run("debt"))).map((r) => r.suggestion.topic);
    expect(shown.slice(0, 3)).toEqual(["debt_plan", "high_cost_loans", "low_balance"]);
    // The tips that need spare cash or a new card are never in his top three, and Jane
    // doesn't suggest a new cost like renters insurance while he is struggling.
    for (const tip of [
      "card_interest",
      "balance_transfer",
      "credit_building",
      "renters_insurance",
    ]) {
      expect(shown.slice(0, 3), tip).not.toContain(tip);
    }
    expect(run("debt").some((s) => s.topic === "renters_insurance")).toBe(false);
  });

  it("leads with the card interest for Maya, who is paying it and can act", () => {
    const order: string[] = ranked("renter").map((s) => s.topic);
    expect(order.indexOf("card_interest")).toBeLessThan(order.indexOf("balance_transfer"));
    expect(order.indexOf("card_interest")).toBeLessThan(order.indexOf("subscriptions"));
  });

  it("ranks an urgent shortage of cash for Chris above his small subscription savings", () => {
    const order: string[] = ranked("debt").map((s) => s.topic);
    expect(order.indexOf("low_balance")).toBeLessThan(order.indexOf("subscriptions"));
    const low = run("debt").find((s) => s.topic === "low_balance")!;
    expect(low.urgency).toBe("now");
    // Maya has two thirds of a month of bills in cash: soon, not now.
    expect(run("renter").find((s) => s.topic === "low_balance")!.urgency).toBe("soon");
  });
});

describe("dollars", () => {
  it("shows Chris's pay-down only as what getting under the line is worth, not the whole pay-down", () => {
    const s = run("debt").find((x) => x.topic === "credit_building")!;
    expect(s.worthCents).toBeLessThan(50_000);
    expect(s.why).toMatch(/pay what you can before each statement closes/);
  });

  it("doesn't count one month's party as a year of overspending", () => {
    const s = run("family").find((x) => x.topic === "budget_overrun")!;
    // The overrun that month, once; not twelve of them.
    expect(s.worthCents).toBe(123_180);
    expect(s.confidence.percent).toBeLessThanOrEqual(75);
    expect(s.confidence.reason).toContain("one month isn't a pattern");
  });
});

describe("confidence", () => {
  it("is lower for what Jane guessed or can't see than for what it counted", () => {
    const guessedTopics = [
      ["family", "car_addons"],
      ["family", "student_forgiveness"],
      ["preretire", "family_loans"],
      ["freelancer", "student_repayment"],
      ["debt", "balance_transfer"],
      ["renter", "credit_building"],
    ] as const;
    for (const [id, topic] of guessedTopics) {
      const s = run(id).find((x) => x.topic === topic)!;
      expect(s, `${id} ${topic}`).toBeDefined();
      expect(s.confidence.percent, `${id} ${topic}`).toBeLessThanOrEqual(75);
    }
    for (const [id, topic] of [
      ["renter", "card_interest"],
      ["debt", "credit_report_errors"],
      ["retiree", "medical_bills"],
    ] as const) {
      expect(
        run(id).find((x) => x.topic === topic)!.confidence.percent,
        topic,
      ).toBeGreaterThanOrEqual(85);
    }
  });

  it("falls with thin data: two months of charges are surer of nothing than a year of them", () => {
    const thin = (d: ProfileInput): ProfileInput => ({
      ...d,
      transactions: d.transactions.filter((t) => t.date >= "2026-08-18"),
    });
    const full = run("debt").find((s) => s.topic === "card_interest")!;
    const short = run("debt", thin).find((s) => s.topic === "card_interest");
    expect(short).toBeDefined();
    expect(short!.confidence.percent).toBeLessThan(full.confidence.percent - 10);
    expect(short!.confidence.reason).toContain("2 months of data");
  });

  it("is not all the same: the eight people's debt and spending suggestions span a real range", () => {
    const all = PEOPLE.flatMap((p) => run(p.id)).map((s) => s.confidence.percent);
    expect(Math.max(...all) - Math.min(...all)).toBeGreaterThanOrEqual(25);
  });
});

// The debt and spending detectors' topics (the other lanes' are judged in their own reviews).
const OURS = new Set([
  "subscriptions",
  "duplicate_subscription",
  "price_increase",
  "trial_conversion",
  "bank_fees",
  "late_fees",
  "card_interest",
  "balance_transfer",
  "credit_building",
  "bnpl",
  "medical_bills",
  "credit_report_errors",
  "student_repayment",
  "student_forgiveness",
  "auto_refinance",
  "car_addons",
  "cash_advance",
  "mortgage_extra",
  "family_loans",
  "pmi_removal",
  "refinance",
  "high_cost_loans",
  "debt_plan",
  "hardship_plan",
  "bill_negotiation",
  "duplicate_charge",
  "low_balance",
  "budget_overrun",
  "emergency_fund",
  "idle_cash",
]);

describe("plain words", () => {
  const all = PEOPLE.flatMap((p) => run(p.id).map((s) => ({ person: p.id, s })));

  it("never reads '1 cards' or '1 payments': one is singular", () => {
    for (const { person, s } of all) {
      expect(s.confidence.reason, `${person} ${s.topic}`).not.toMatch(
        /\b1 [a-z -]*?(cards|payments|charges|fees|transfers|accounts|bills|installments|holdings|records|plans)\b/,
      );
    }
  });

  it("names merchants as people do, not as the bank prints them", () => {
    for (const { person, s } of all) {
      const shouting = s.why
        .match(/\b[A-Z]{5,}\b/g)
        ?.filter((w) => !["MEDICARE", "FINRA"].includes(w));
      expect(shouting ?? [], `${person} ${s.topic}: ${s.why}`).toEqual([]);
    }
    expect(run("renter").find((s) => s.topic === "duplicate_subscription")!.why).toContain(
      "Netflix and Hulu",
    );
    expect(run("family").find((s) => s.topic === "duplicate_subscription")!.why).toContain(
      "Disney Plus, Netflix and Hulu",
    );
  });

  it("gives every 'why you' the person's own dollars", () => {
    for (const { person, s } of all.filter(({ s }) => OURS.has(s.topic))) {
      expect(s.why, `${person} ${s.topic}`).toMatch(/\$[\d,]+/);
    }
  });

  it("tells Maya what went up, biggest yearly rise first, in plain words", () => {
    const s = run("renter").find((x) => x.topic === "price_increase")!;
    const m = s.why.match(
      /^(.+) went from \$([\d.,]+) to \$([\d.,]+) a month(?:, and \d+ more went up)?: \$([\d.,]+) more a year\.$/,
    );
    expect(m, s.why).not.toBeNull();
    const [, name, before, now] = m!;
    expect(name).toMatch(/^[A-Z][a-z]+( [A-Z][a-z]+)*$/);
    expect(Number(now.replace(/,/g, ""))).toBeGreaterThan(Number(before.replace(/,/g, "")));
    expect(s.why).toContain("Progressive Auto");
    expect(s.confidence.reason).toMatch(/\d+ charges? at the old price in 12 months of data/);
  });

  it("keeps the leading debt wording for someone who can't pay it off", () => {
    expect(run("debt").find((s) => s.topic === "card_interest")!.why).toContain(
      "a payoff plan that starts with the highest rate stops it, a card at a time",
    );
    expect(mine(["card_interest"], run("renter"))[0].why).toContain(
      "paying the balance off ends it",
    );
  });
});
