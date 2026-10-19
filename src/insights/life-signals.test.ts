import { describe, expect, it } from "vitest";
import { input, monthsAgo, tx } from "@/detection/__fixtures__/build";
import type { DetectionTransaction } from "@/detection/types";
import { addDays } from "@/detection/units";
import { lifeEventGuesses } from "./life-signals";

// Spec step 100: two or more kinds of signal ask; one never does. AS_OF is 2026-10-15.

const OLD_RENT = {
  description: "OAK APARTMENTS RENT",
  pfcPrimary: "RENT_AND_UTILITIES",
  pfcDetailed: "RENT_AND_UTILITIES_RENT",
  amountCents: 180_000,
};
const NEW_RENT = { ...OLD_RENT, description: "MAPLE COURT LEASING RENT" };
const UHAUL = {
  description: "U-HAUL MOVING",
  merchantName: "U-Haul",
  pfcPrimary: "GENERAL_SERVICES",
  amountCents: 24_000,
};
const POWER = {
  description: "CITY POWER CO",
  pfcPrimary: "RENT_AND_UTILITIES",
  pfcDetailed: "RENT_AND_UTILITIES_GAS_AND_ELECTRICITY",
  amountCents: 9_000,
};
const NEW_POWER = { ...POWER, description: "VALLEY ELECTRIC" };
const PAY = {
  description: "ACME CORP PAYROLL",
  pfcPrimary: "INCOME",
  pfcDetailed: "INCOME_SALARY",
  amountCents: -245_000,
};

const history: DetectionTransaction[] = [4, 3, 2].flatMap((m) => [
  tx({ ...OLD_RENT, date: monthsAgo(m, 1) }),
  tx({ ...POWER, date: monthsAgo(m, 5) }),
]);
const guesses = (transactions: DetectionTransaction[]) =>
  lifeEventGuesses(input({ transactions: [...history, ...transactions] }));

describe("moving", () => {
  it("asks with a mover and a new landlord", () => {
    const [guess] = guesses([
      tx({ ...UHAUL, date: "2026-09-28" }),
      tx({ ...NEW_RENT, date: "2026-10-01" }),
    ]);
    expect(guess.kind).toBe("moving");
    expect(guess.signals.map((s) => s.key)).toEqual(["moving_company", "new_housing"]);
    expect(guess.signals[0].text).toBe("a U-Haul charge on Sep 28");
    expect(guess.signals[1].text).toMatch(/^a first rent payment to /);
  });

  it("also counts new utilities and a lot of furniture", () => {
    const [guess] = guesses([
      tx({ ...NEW_POWER, date: "2026-10-05" }),
      tx({
        description: "IKEA",
        pfcPrimary: "HOME_IMPROVEMENT",
        pfcDetailed: "HOME_IMPROVEMENT_FURNITURE",
        amountCents: 80_000,
        date: "2026-10-03",
      }),
    ]);
    expect(guess.signals.map((s) => s.key)).toEqual(["furniture", "new_utility"]);
    expect(guess.signals[0].text).toBe("$800.00 on furniture");
  });

  it("never asks on one signal, twice the same signal, or old signals", () => {
    expect(guesses([tx({ ...UHAUL, date: "2026-10-01" })])).toEqual([]);
    expect(
      guesses([tx({ ...UHAUL, date: "2026-10-01" }), tx({ ...UHAUL, date: "2026-10-02" })]),
    ).toEqual([]);
    // Both more than 60 days ago.
    expect(
      guesses([tx({ ...UHAUL, date: "2026-07-01" }), tx({ ...NEW_RENT, date: "2026-07-01" })]),
    ).toEqual([]);
  });

  it("doesn't count a first rent payment when there's no history before it", () => {
    const fresh = lifeEventGuesses(
      input({
        transactions: [
          tx({ ...UHAUL, date: "2026-10-01" }),
          tx({ ...NEW_RENT, date: "2026-10-02" }),
        ],
      }),
    );
    expect(fresh).toEqual([]);
  });
});

describe("a new job", () => {
  // Every two weeks from Acme until Sep 4.
  const acme = Array.from({ length: 8 }, (_, i) =>
    tx({ ...PAY, date: addDays("2026-09-04", -14 * (7 - i)) }),
  );

  it("asks when the old paychecks stop and a new employer pays", () => {
    const [guess] = lifeEventGuesses(
      input({
        transactions: [
          ...acme,
          tx({ ...PAY, description: "GLOBEX PAYROLL", date: "2026-10-02", amountCents: -280_000 }),
        ],
      }),
    );
    expect(guess.kind).toBe("new_job");
    expect(guess.signals.map((s) => s.key)).toEqual(["paychecks_stopped", "new_employer"]);
    expect(guess.signals[1].text).toBe("a first paycheck from Globex on Oct 2");
  });

  it("doesn't ask on a raise alone", () => {
    const raise = [...acme.slice(0, -1), tx({ ...PAY, date: "2026-10-02", amountCents: -300_000 })];
    expect(lifeEventGuesses(input({ transactions: raise }))).toEqual([]);
  });
});

describe("a new baby", () => {
  it("asks with two kinds of baby signs, never one", () => {
    const store = tx({
      description: "BUYBUY BABY #123",
      merchantName: "buybuy BABY",
      pfcPrimary: "GENERAL_MERCHANDISE",
      amountCents: 15_000,
      date: "2026-09-20",
    });
    const hospital = tx({
      description: "ST MARY HOSPITAL MATERNITY",
      pfcPrimary: "MEDICAL",
      pfcDetailed: "MEDICAL_OTHER_MEDICAL",
      amountCents: 120_000,
      date: "2026-10-01",
    });
    const care = tx({
      description: "LITTLE STARS DAYCARE",
      pfcPrimary: "GENERAL_SERVICES",
      pfcDetailed: "GENERAL_SERVICES_CHILDCARE",
      amountCents: 90_000,
      date: "2026-10-10",
    });
    expect(lifeEventGuesses(input({ transactions: [store] }))).toEqual([]);
    const [guess] = lifeEventGuesses(input({ transactions: [store, hospital, care] }));
    expect(guess).toMatchObject({ kind: "new_baby" });
    expect(guess.signals.map((s) => s.text)).toEqual([
      "a purchase at Buybuy Baby",
      "a $1,200.00 hospital bill",
      "a childcare payment",
    ]);
  });

  it("doesn't take a small doctor's bill for a birth", () => {
    const store = tx({
      description: "BUYBUY BABY #123",
      merchantName: "buybuy BABY",
      pfcPrimary: "GENERAL_MERCHANDISE",
      amountCents: 15_000,
      date: "2026-09-20",
    });
    const clinic = tx({
      description: "HOSPITAL PARKING",
      pfcPrimary: "MEDICAL",
      amountCents: 1_500,
      date: "2026-10-01",
    });
    expect(lifeEventGuesses(input({ transactions: [store, clinic] }))).toEqual([]);
  });
});
