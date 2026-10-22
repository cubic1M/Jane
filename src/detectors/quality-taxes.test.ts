import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));

import { PERSON_IDS, type PersonId } from "@/config/people";
import { rankSuggestions } from "@/planning/suggestion-rank";
import { buildProfile, type ProfileInput } from "@/profile/build";
import { inputFor } from "@/profile/sample";
import { runDetectors } from "./index";

// Step 261 review: the tax suggestions as a skeptical customer reads them. Wording and ranges
// are pinned here; the verdicts are in docs/detectors/review-taxes.md.

const run = (id: PersonId, change: (d: ProfileInput) => ProfileInput = (d) => d) => {
  const data = change(inputFor(id));
  return runDetectors({ profile: buildProfile(data), data });
};
const ranked = (id: PersonId, change?: (d: ProfileInput) => ProfileInput) =>
  rankSuggestions(run(id, change)).map((r) => r.suggestion);
const tax = (id: PersonId, change?: (d: ProfileInput) => ProfileInput) =>
  run(id, change).filter((s) => s.capability === "taxes");
const topic = (id: PersonId, t: string, change?: (d: ProfileInput) => ProfileInput) =>
  tax(id, change).find((s) => s.topic === t)!;
const inFebruary = (d: ProfileInput): ProfileInput => ({ ...d, today: "2027-02-10" });
const noSocialSecurity = (d: ProfileInput): ProfileInput => ({
  ...d,
  transactions: d.transactions.filter((t) => !/SOC SEC/.test(t.description)),
});
const inDecember = (d: ProfileInput): ProfileInput => ({ ...d, today: "2026-12-05" });

describe("dollars", () => {
  it("shows the identity PIN as a small expected loss, not the whole refund", () => {
    const s = topic("renter", "identity_ip_pin", inFebruary);
    expect(s.worthCents).toBeLessThan(10_000);
    expect(s.confidence.percent).toBeLessThanOrEqual(60);
    expect(s.why).toMatch(/Few people are ever targeted/);
  });

  it("doesn't promise a late-filing penalty to someone who may be due a refund", () => {
    const s = topic("renter", "file_return", inFebruary);
    expect(s.worthCents).toBeLessThan(15_000);
    expect(s.why).toMatch(/If you owe tax.*if you're due a refund there's no penalty/);
    expect(s.confidence.reason).toMatch(/owe tax or are due a refund/);
  });

  it("counts the tax on stock vesting as a bill to plan for, and ranks it that way for Priya", () => {
    const s = topic("equity", "withholding_gap");
    expect(s.worthCents).toBe(647_900);
    expect(s.rankCents).toBe(Math.round(647_900 * 0.3));
    expect(s.why).toMatch(/penalty of about \$518\.32 on top/);
    const top = ranked("equity")
      .slice(0, 4)
      .map((x) => x.topic);
    expect(top).toContain("withholding_gap");
  });

  it("uses one bracket for a person in every tax suggestion, vesting stock included", () => {
    const brackets = (id: PersonId, change?: (d: ProfileInput) => ProfileInput) =>
      tax(id, change)
        .map((s) => /at your (\d+)% bracket|in the (\d+)% bracket/.exec(s.why))
        .filter((m): m is RegExpExecArray => m !== null)
        .map((m) => m[1] ?? m[2]);
    expect(new Set(brackets("equity")).size).toBe(1);
    expect(brackets("equity")).toEqual(expect.arrayContaining(["32"]));
  });

  it("taxes a shop on its profit, not on its sales", () => {
    const s = topic("owner", "estimated_taxes");
    // Deposits are about $492,000 a year; a 15% profit share, 25% tax, 8% penalty.
    expect(s.worthCents).toBeLessThan(250_000);
    expect(s.confidence.percent).toBeLessThanOrEqual(60);
    expect(s.confidence.reason).toMatch(/deposits are sales, so I assumed 15% is profit/);
  });

  it("sizes a Roth conversion to a retiree's real bracket room, and doesn't tell her to convert what she must withdraw", () => {
    // Ruth's Social Security makes 85 cents of it taxable for each converted dollar (step 271),
    // so at her income a conversion costs about what it saves: not raised. Without it, sized.
    expect(tax("retiree").map((s) => s.topic)).not.toContain("roth_conversion");
    const ruth = topic("retiree", "roth_conversion", noSocialSecurity);
    const dan = topic("preretire", "roth_conversion");
    expect(ruth.worthCents).toBeLessThan(dan.worthCents);
    expect(ruth.why).toMatch(/bracket now, with about \$[\d,.]+ of room before the next one/);
    expect(ruth.why).toMatch(/Money you must withdraw this year can't be converted/);
    expect(dan.why).toMatch(/years after you stop working/);
  });

  it("never pushes a 401(k) top-up past a tenth of income, or on someone in debt trouble", () => {
    const maya = topic("renter", "year_end_moves", inDecember);
    const topUp = Number(/About \$([\d,]+)\.\d\d more/.exec(maya.why)![1].replace(",", ""));
    expect(topUp).toBeGreaterThan(0);
    expect(topUp).toBeLessThan(6_125);
    expect(tax("debt", inDecember).map((s) => s.topic)).not.toContain("year_end_moves");
  });
});

describe("confidence", () => {
  it("is lower for what Jane can't see, with a reason a person would accept", () => {
    const cases: [PersonId, string, number, RegExp][] = [
      ["family", "childcare_tax_break", 65, /employer offers a dependent care FSA/],
      ["family", "charity_receipts", 60, /already have the receipt, or whether you itemize/],
      ["family", "property_tax_check", 45, /haven't seen your assessment/],
      ["equity", "withholding_gap", 70, /no vest schedule/],
      ["preretire", "roth_conversion", 55, /assumptions/],
      ["retiree", "social_security_tax", 55, /whether tax is already withheld/],
      ["preretire", "irmaa_watch", 50, /I don't know your age/],
      ["renter", "year_end_moves", 50, /can't see what you've put in/],
    ];
    for (const [id, t, max, reason] of cases) {
      const s = topic(id, t, t === "year_end_moves" ? inDecember : undefined);
      expect(s.confidence.percent, `${id} ${t}`).toBeLessThanOrEqual(max);
      expect(s.confidence.reason, `${id} ${t}`).toMatch(reason);
    }
  });

  it("is high only for what Jane counted: a loss she can see in a taxable account, an unpaid quarter", () => {
    expect(topic("equity", "tax_loss_harvest").confidence.percent).toBeGreaterThanOrEqual(75);
    expect(topic("freelancer", "estimated_taxes").confidence.percent).toBeGreaterThanOrEqual(75);
  });

  it("spreads across the tax suggestions instead of sitting at one number", () => {
    const all = PERSON_IDS.flatMap((id) => [
      ...tax(id),
      ...tax(id, inFebruary),
      ...tax(id, inDecember),
    ]).map((s) => s.confidence.percent);
    expect(Math.min(...all)).toBeLessThanOrEqual(50);
    expect(Math.max(...all)).toBeGreaterThanOrEqual(75);
    expect(new Set(all).size).toBeGreaterThanOrEqual(6);
  });
});

describe("words", () => {
  it("never shows a bare count as a reason, 'months of data' for a holding, or a raw date", () => {
    for (const id of PERSON_IDS) {
      for (const change of [undefined, inFebruary, inDecember]) {
        for (const s of tax(id, change)) {
          expect(s.confidence.reason, `${id} ${s.topic}`).not.toMatch(/\bsignals?\b/);
          if (s.topic === "tax_loss_harvest")
            expect(s.confidence.reason).not.toMatch(/months of data/);
          expect(s.why, `${id} ${s.topic}`).not.toMatch(/\d{4}-\d{2}-\d{2}|undefined|NaN/);
          expect(s.why, `${id} ${s.topic}`).not.toMatch(/\b1 [a-z]+s\b/);
          expect(s.title.endsWith("."), `${id} ${s.topic}`).toBe(false);
        }
      }
    }
  });
});

describe("a sensible top three, in the person's life", () => {
  it("shows each person their biggest tax item near the top", () => {
    const rank = (id: PersonId, t: string, change?: (d: ProfileInput) => ProfileInput) =>
      ranked(id, change).findIndex((s) => s.topic === t);
    expect(rank("equity", "withholding_gap")).toBeLessThan(4);
    expect(rank("preretire", "roth_conversion")).toBeLessThan(3);
    expect(rank("owner", "estimated_taxes")).toBeLessThan(4);
    // In December the Reyes family's biggest tax item is their flood (step 270: deadlines
    // moved, a casualty loss), at the top; their year-end moves follow the insurance gaps.
    expect(rank("family", "disaster_relief", inDecember)).toBe(0);
    expect(rank("family", "year_end_moves", inDecember)).toBeLessThan(6);
  });

  it("keeps the small, unsure ones low: receipts, an appeal nobody has priced, a filing nudge", () => {
    const order = ranked("family").map((s) => s.topic);
    expect(order.indexOf("charity_receipts")).toBeGreaterThan(order.indexOf("pmi_removal"));
    expect(order.indexOf("property_tax_check")).toBeGreaterThan(order.indexOf("emergency_fund"));
    for (const id of PERSON_IDS) {
      const o = ranked(id, inFebruary).map((s) => s.topic);
      if (o.includes("identity_ip_pin")) expect(o.indexOf("identity_ip_pin")).toBeGreaterThan(4);
    }
  });

  it("brings deadlines forward as they near", () => {
    const urgency = (id: PersonId, t: string, change?: (d: ProfileInput) => ProfileInput) =>
      topic(id, t, change).urgency;
    expect(urgency("freelancer", "estimated_taxes")).toBe("later");
    expect(urgency("freelancer", "estimated_taxes", inDecember)).toBe("soon");
    expect(urgency("freelancer", "estimated_taxes", (d) => ({ ...d, today: "2026-09-10" }))).toBe(
      "now",
    );
    expect(urgency("renter", "file_return", (d) => ({ ...d, today: "2027-04-05" }))).toBe("now");
    expect(urgency("preretire", "roth_conversion", (d) => ({ ...d, today: "2026-11-20" }))).toBe(
      "soon",
    );
  });
});
