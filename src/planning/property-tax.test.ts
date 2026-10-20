import { describe, expect, it } from "vitest";
import {
  APPEAL_GAP_RATE,
  APPEAL_MIN_SAVING_CENTS,
  EXEMPTIONS,
  STATE_PROPERTY,
} from "@/config/property-tax";
import { demoPropertyPartner } from "@/lib/property/demo";
import {
  appealWindow,
  assessmentGap,
  draftAppeal,
  exemptionsToClaim,
  indicatedValue,
} from "./property-tax";

// Spec step 221: an appeal is suggested only past the config threshold; the county's window,
// the exemptions not yet claimed, and the drafted appeal with its comparables.

const $ = (d: number) => Math.round(d * 100);

describe("the assessment gap", () => {
  it("suggests an appeal only when the gap and the saving are over the config thresholds", () => {
    const over = assessmentGap({
      assessedCents: $(560_000),
      marketCents: $(500_000),
      taxPaidCents: $(6_160),
      state: "TX",
    });
    expect(over.gapRate).toBeCloseTo(0.12);
    expect(over.measured).toBe(true);
    expect(over.taxRate).toBeCloseTo(6_160 / 560_000);
    expect(over.savingCents).toBe(Math.round($(60_000) * (6_160 / 560_000)));
    expect(over.worthAppealing).toBe(true);

    // Just under the gap threshold: assessed 6.9% over.
    const under = assessmentGap({
      assessedCents: Math.round($(500_000) * (1 + APPEAL_GAP_RATE - 0.001)),
      marketCents: $(500_000),
      taxPaidCents: $(6_000),
      state: "TX",
    });
    expect(under.worthAppealing).toBe(false);

    // A big gap on a cheap home saves too little to bother.
    const small = assessmentGap({
      assessedCents: $(10_000),
      marketCents: $(8_000),
      taxPaidCents: 0,
      state: "CA",
    });
    expect(small.gapRate).toBeGreaterThan(APPEAL_GAP_RATE);
    expect(small.savingCents).toBeLessThan(APPEAL_MIN_SAVING_CENTS);
    expect(small.worthAppealing).toBe(false);
  });

  it("prices the saving at the state's typical rate without a bill, and never goes negative", () => {
    const g = assessmentGap({
      assessedCents: $(600_000),
      marketCents: $(500_000),
      taxPaidCents: 0,
      state: "NJ",
    });
    expect(g.measured).toBe(false);
    expect(g.taxRate).toBe(STATE_PROPERTY.NJ.effectiveRate);
    const below = assessmentGap({
      assessedCents: $(400_000),
      marketCents: $(500_000),
      taxPaidCents: 0,
      state: null,
    });
    expect(below.savingCents).toBe(0);
    expect(below.worthAppealing).toBe(false);
  });
});

describe("the appeal window", () => {
  it("uses the state's fixed window, rolling to next year once it has closed", () => {
    expect(appealWindow("CA", "2026-10-19", null)).toMatchObject({
      status: "open",
      opensOn: "2026-07-02",
      closesOn: "2026-11-30",
    });
    expect(appealWindow("CA", "2026-06-01", null)).toMatchObject({
      status: "upcoming",
      opensOn: "2026-07-02",
      closesOn: "2026-06-01".replace("06-01", "11-30"),
    });
    expect(appealWindow("CA", "2026-12-15", null)).toMatchObject({
      status: "upcoming",
      opensOn: "2027-07-02",
      closesOn: "2027-11-30",
    });
    expect(appealWindow("NJ", "2026-03-01", null)).toMatchObject({
      status: "open",
      closesOn: "2026-04-01",
    });
  });

  it("says dates in words", () => {
    expect(appealWindow("CA", "2026-10-19", null).text).toBe(
      "You can appeal to the county Assessment Appeals Board until Nov 30, 2026.",
    );
    expect(appealWindow("CA", "2026-06-01", null).text).toBe(
      "Appeals to the county Assessment Appeals Board open on Jul 2, 2026 and close on Nov 30, 2026.",
    );
    expect(appealWindow("FL", "2026-10-19", "2026-08-10").text).toBe(
      "The window to appeal to the Value Adjustment Board closed on Sep 4, 2026. The next one is after your next assessment notice.",
    );
  });

  it("counts days from the notice when the state does", () => {
    expect(appealWindow("FL", "2026-08-20", "2026-08-10")).toMatchObject({
      status: "open",
      closesOn: "2026-09-04",
    });
    expect(appealWindow("FL", "2026-10-19", "2026-08-10")).toMatchObject({
      status: "closed",
      closesOn: "2026-09-04",
    });
    // Texas: May 15 or 30 days after the notice, whichever is later.
    expect(appealWindow("TX", "2026-05-20", "2026-05-10")).toMatchObject({
      status: "open",
      closesOn: "2026-06-09",
    });
  });

  it("asks for the notice date when it can't know", () => {
    const w = appealWindow("FL", "2026-10-19", null);
    expect(w.status).toBe("unknown");
    expect(w.closesOn).toBeNull();
    expect(w.text).toContain("deadline is printed on your assessment notice");
    expect(appealWindow(null, "2026-10-19", null).status).toBe("unknown");
  });
});

describe("exemptions", () => {
  it("offers the homestead exemption to any owner, and others when the facts fit", () => {
    const facts = { age: null, veteran: null, disabled: null, claimed: [] as string[] };
    const none = exemptionsToClaim("TX", facts);
    expect(none.eligible.map((e) => e.key)).toEqual(["tx_homestead"]);
    expect(none.ask).toEqual([
      "your age",
      "whether you served in the military",
      "whether you have a service-connected disability",
    ]);

    const senior = exemptionsToClaim("TX", { ...facts, age: 67, veteran: true, disabled: false });
    expect(senior.eligible.map((e) => e.key)).toEqual(["tx_homestead", "tx_over65"]);
    expect(senior.ask).toEqual([]);

    const vet = exemptionsToClaim("TX", { age: 40, veteran: true, disabled: true, claimed: [] });
    expect(vet.eligible.map((e) => e.key)).toEqual(["tx_homestead", "tx_disabled_veteran"]);
  });

  it("leaves out what's claimed, and states without a table give none", () => {
    expect(
      exemptionsToClaim("TX", {
        age: 70,
        veteran: false,
        disabled: false,
        claimed: ["tx_homestead", "tx_over65"],
      }).eligible,
    ).toEqual([]);
    expect(
      exemptionsToClaim("AK", { age: 70, veteran: true, disabled: true, claimed: [] }),
    ).toEqual({ eligible: [], ask: [] });
  });

  it("has a source for every exemption", () => {
    for (const [state, list] of Object.entries(EXEMPTIONS)) {
      for (const e of list) expect(e.source.length, `${state} ${e.key}`).toBeGreaterThan(10);
    }
    for (const [state, p] of Object.entries(STATE_PROPERTY))
      expect(p.window.source.length, state).toBeGreaterThan(10);
  });
});

describe("the drafted appeal", () => {
  const record = demoPropertyPartner.lookup({
    mortgageBalanceCents: $(312_400),
    today: "2026-10-19",
  })!;

  it("states the assessment, the comparables and the indicated value", () => {
    expect(record.marketCents).toBe(Math.round($(312_400) / 0.6));
    expect(record.assessedCents).toBe(Math.round(record.marketCents * 1.14));
    expect(record.comps).toHaveLength(3);
    const value = indicatedValue(record.comps);
    const text = draftAppeal({
      year: 2026,
      board: "the county Assessment Appeals Board",
      address: record.address,
      assessedCents: record.assessedCents,
      comps: record.comps,
    });
    expect(text).toContain("To: the county Assessment Appeals Board");
    expect(text).toContain(`reduced to $${Math.round(value / 100).toLocaleString("en-US")}`);
    for (const c of record.comps) expect(text).toContain(c.address);
    expect(text).not.toMatch(/will win|guarantee/i);
  });

  it("takes the middle comparable's adjusted price", () => {
    expect(indicatedValue([])).toBe(0);
    expect(
      indicatedValue([{ adjustedCents: 3 }, { adjustedCents: 1 }, { adjustedCents: 2 }] as never),
    ).toBe(2);
    expect(indicatedValue([{ adjustedCents: 1 }, { adjustedCents: 3 }] as never)).toBe(2);
  });

  it("gives the stand-in nothing for a person without a mortgage", () => {
    expect(
      demoPropertyPartner.lookup({ mortgageBalanceCents: null, today: "2026-10-19" }),
    ).toBeNull();
  });
});
