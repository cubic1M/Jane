import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));

import { parseIntent } from "@/lib/jane-agent/intents";
import {
  appliedNote,
  deductibleBody,
  sameCoverBody,
  savingLine,
} from "@/lib/jane-agent/insurance/saving-words";
import type { Saving } from "./savings";
import {
  autopay,
  bundle,
  findSavings,
  higherDeductible,
  lowersCover,
  paperless,
  payInFull,
  telematics,
  type SavingPolicy,
} from "./saving-rules";

// Paying less for the same cover (spec step 196): every rule, and how Jane says each. Pure.

const car = (over: Partial<SavingPolicy> = {}): SavingPolicy => ({
  id: "car",
  kind: "auto",
  carrier: "GEICO",
  premiumCents: 14_200,
  premiumFrequency: "monthly",
  deductibleCents: 100_000,
  ...over,
});
const home = (over: Partial<SavingPolicy> = {}): SavingPolicy => ({
  id: "home",
  kind: "home",
  carrier: "State Farm",
  premiumCents: 10_000,
  premiumFrequency: "monthly",
  deductibleCents: 100_000,
  ...over,
});
const CASH = 2_800_000;

describe("pay in full", () => {
  it("takes the installment fees and the carrier's discount off, when the cash covers the year", () => {
    // 12 fees of $4.00 and 5% of $1,704.00 = $48.00 + $85.20.
    expect(payInFull(car(), CASH)).toMatchObject({
      kind: "pay_in_full",
      yearlySavingCents: 13_320,
      currentYearlyCents: 170_400,
      newYearlyCents: 157_080,
      detail: { payNowCents: 157_080 },
    });
  });
  it("needs the cash for the year, and a policy not already paid yearly", () => {
    expect(payInFull(car(), 100_000)).toBeNull();
    expect(payInFull(car({ premiumFrequency: "yearly", premiumCents: 170_400 }), CASH)).toBeNull();
    expect(payInFull(car({ premiumCents: null }), CASH)).toBeNull();
  });
  it("counts fewer fees for a policy paid twice a year", () => {
    const half = car({ premiumFrequency: "semiannual", premiumCents: 85_200 });
    expect(payInFull(half, CASH)?.yearlySavingCents).toBe(2 * 400 + 8_520);
  });
});

describe("autopay, paperless and the safe-driver program", () => {
  it("take their share of the year", () => {
    expect(autopay(car())?.yearlySavingCents).toBe(5_112);
    expect(paperless(car())?.yearlySavingCents).toBe(3_408);
    expect(telematics(car())?.yearlySavingCents).toBe(17_040);
  });
  it("offer the safe-driver program only on a car policy", () => {
    expect(telematics(home())).toBeNull();
    expect(autopay(home())?.yearlySavingCents).toBe(3_600);
  });
  it("skip a saving too small to be worth a message", () => {
    expect(autopay(car({ premiumCents: 400 }))).toBeNull();
  });
});

describe("one carrier for car and home", () => {
  it("takes a share off both when they're with different carriers", () => {
    expect(bundle(car(), [car(), home()])).toMatchObject({
      kind: "bundle",
      policyId: "car",
      // 10% of $1,704.00 + $1,200.00.
      yearlySavingCents: 29_040,
      detail: { withPolicyId: "home", withCarrier: "State Farm" },
    });
  });
  it("is nothing when they're with one carrier already, or there's no home or renters policy", () => {
    expect(bundle(car(), [car(), home({ carrier: "geico" })])).toBeNull();
    expect(bundle(car(), [car()])).toBeNull();
    expect(bundle(home(), [car(), home()])).toBeNull();
  });
  it("counts renters like a home", () => {
    expect(bundle(car(), [car(), home({ kind: "renters" })])?.detail.withPolicyId).toBe("home");
  });
});

describe("a higher deductible", () => {
  it("steps up the carrier's ladder, shown with the amounts either side", () => {
    expect(higherDeductible(car(), CASH)).toMatchObject({
      kind: "higher_deductible",
      yearlySavingCents: 17_040,
      detail: { fromDeductibleCents: 100_000, toDeductibleCents: 200_000 },
    });
    expect(lowersCover("higher_deductible")).toBe(true);
    expect(lowersCover("autopay")).toBe(false);
  });
  it("only when savings cover the new deductible twice over", () => {
    expect(higherDeductible(car(), 399_999)).toBeNull();
    expect(higherDeductible(car(), 400_000)).not.toBeNull();
  });
  it("is nothing at the top of the ladder, without a known deductible, or for other kinds", () => {
    expect(higherDeductible(car({ deductibleCents: 200_000 }), CASH)).toBeNull();
    expect(higherDeductible(car({ deductibleCents: null }), CASH)).toBeNull();
    expect(higherDeductible(car({ kind: "life" }), CASH)).toBeNull();
  });
});

describe("all of them together", () => {
  it("finds every saving on a policy, never one already answered", () => {
    const all = findSavings([car(), home()], CASH);
    expect(all.filter((s) => s.policyId === "car").map((s) => s.kind)).toEqual([
      "pay_in_full",
      "autopay",
      "paperless",
      "telematics",
      "bundle",
      "higher_deductible",
    ]);
    const left = findSavings([car(), home()], CASH, new Set(["car:autopay", "car:bundle"]));
    expect(left.filter((s) => s.policyId === "car").map((s) => s.kind)).not.toContain("autopay");
    expect(left.map((s) => s.kind)).not.toContain("bundle");
  });
  it("leaves out kinds without these programs", () => {
    expect(findSavings([car({ kind: "life" }), car({ id: "pet", kind: "pet" })], CASH)).toEqual([]);
  });
});

describe("in the chat", () => {
  const saving = (over: Partial<Saving>): Saving => ({
    id: "s1",
    policyId: "car",
    kind: "autopay",
    status: "offered",
    yearlySavingCents: 5_112,
    currentYearlyCents: 170_400,
    newYearlyCents: 165_288,
    detail: {},
    confirmation: null,
    ...over,
  });
  const policies = [{ id: "car", carrier: "GEICO", kind: "auto" as const }];

  it("says each saving with its yearly figure, and the cover staying as it is", () => {
    expect(
      sameCoverBody(
        [
          saving({}),
          saving({
            id: "s2",
            kind: "pay_in_full",
            yearlySavingCents: 13_320,
            detail: { payNowCents: 157_080 },
          }),
        ],
        policies,
      ).split("\n"),
    ).toEqual([
      "There are 2 ways to pay less for the cover you already have.",
      "- Turn on autopay for your GEICO car policy: about $51.12 a year less",
      "- Pay your GEICO car policy once a year instead of in installments, $1,570.80 up front: about $133.20 a year less",
      "Together that's up to about $184.32 a year (they overlap a little), and your cover stays exactly as it is.",
    ]);
    expect(savingLine(saving({ kind: "paperless" }), policies[0])).toBe(
      "Switch your GEICO car policy to paperless: about $51.12 a year less",
    );
  });

  it("says a higher deductible both ways, and that it lowers the cover", () => {
    expect(
      deductibleBody(
        saving({
          kind: "higher_deductible",
          yearlySavingCents: 17_040,
          detail: { fromDeductibleCents: 100_000, toDeductibleCents: 200_000 },
        }),
        policies[0],
      ).split("\n"),
    ).toEqual([
      "Raising the deductible on your GEICO car policy from $1,000.00 to $2,000.00 would save about $170.40 a year.",
      "The other side: if you claim, you'd pay $1,000.00 more yourself. Your savings cover it, but this one lowers your cover, so it's your call.",
    ]);
  });

  it("says what was done", () => {
    expect(appliedNote([saving({})])).toBe(
      "Done. That's about $51.12 a year less, with the same cover.",
    );
    expect(appliedNote([saving({ kind: "higher_deductible" })])).toContain(
      "with a higher deductible",
    );
  });

  it("reads questions about paying less", () => {
    for (const text of [
      "how can I pay less for my car insurance",
      "are there any discounts on my insurance",
    ]) {
      expect(parseIntent(text, "2026-10-19"), text).toMatchObject({
        kind: "insurance",
        ask: "savings",
      });
    }
    expect(parseIntent("what's my deductible", "2026-10-19")).toMatchObject({ ask: "deductible" });
    expect(parseIntent("any discounts on Netflix", "2026-10-19")).not.toMatchObject({
      ask: "savings",
    });
  });
});
