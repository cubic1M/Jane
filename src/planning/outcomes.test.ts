import { describe, expect, it } from "vitest";
import { VERIFIED_PERCENT, WATCH_DAYS } from "@/config/outcomes";
import { addDays } from "@/detection/units";
import { asWatch, outcomeYearly, verifyWatch, watchOfFinding, type OutcomeTx } from "./outcomes";

// The verified savings record's check: a saving counts only when later transactions show it,
// and the transactions that show it are kept as the evidence.

let n = 0;
const tx = (date: string, amountCents: number, description: string, pfc: string | null = null) => ({
  id: `t${(n += 1)}`,
  date,
  amountCents,
  description,
  pfc,
});
const monthly = (description: string, cents: number, dates: string[]): OutcomeTx[] =>
  dates.map((d) => tx(d, cents, description));

const START = "2026-08-10";

describe("a charge that should stop", () => {
  const watch = {
    kind: "charge_stops" as const,
    payees: [
      { description: "HULU 877-8244858", amountCents: 1_799, perYear: 12 },
      { description: "SPOTIFY USA", amountCents: 1_199, perYear: 12 },
    ],
  };
  const history = [
    ...monthly("HULU 877-8244858", 1_799, ["2026-06-03", "2026-07-03", "2026-08-03"]),
    ...monthly("SPOTIFY USA", 1_199, ["2026-06-20", "2026-07-20", "2026-08-20", "2026-09-20"]),
  ];

  it("waits until the next charge was due", () => {
    expect(
      verifyWatch(watch, { startedOn: START, asOf: "2026-09-05", expectedCents: 21_588 }, history),
    ).toEqual({ status: "waiting" });
  });

  it("confirms what stopped, with the last charge as evidence, partly when one goes on", () => {
    const check = verifyWatch(
      watch,
      { startedOn: START, asOf: "2026-09-20", expectedCents: 35_976 },
      history,
    );
    expect(check).toMatchObject({
      status: "partial",
      cents: 1_799 * 12,
      yearly: true,
      percent: VERIFIED_PERCENT.charge_stopped,
    });
    if (check.status !== "partial") throw new Error();
    expect(check.evidence).toEqual([history[2].id]);
    expect(check.proof).toMatch(
      /^Last charged \$17\.99 on Aug 3, nothing since, though the next was due Sep 2\./,
    );
  });

  it("is surer after two missed cycles, and confirmed when that's most of what was expected", () => {
    const check = verifyWatch(
      watch,
      { startedOn: START, asOf: "2026-10-15", expectedCents: 21_588 },
      history.slice(0, 3),
    );
    expect(check).toMatchObject({
      status: "confirmed",
      percent: VERIFIED_PERCENT.charge_stopped_twice,
    });
  });

  it("isn't seen when the charges keep coming", () => {
    const check = verifyWatch(
      { kind: "charge_stops", payees: [watch.payees[1]] },
      { startedOn: START, asOf: "2026-09-25", expectedCents: 14_388 },
      history,
    );
    expect(check).toMatchObject({ status: "not_seen" });
    if (check.status !== "not_seen") throw new Error();
    expect(check.evidence).toEqual([history[5].id]);
  });
});

describe("a bill that should come in lower", () => {
  const watch = {
    kind: "bill_drops" as const,
    payees: [{ description: "COMCAST CABLE", beforeCents: 9_000, perYear: 12 }],
  };
  it("confirms a lower bill from the same payee, a year of the difference", () => {
    const lower = tx("2026-09-12", 7_000, "COMCAST CABLE");
    const check = verifyWatch(
      watch,
      { startedOn: START, asOf: "2026-09-15", expectedCents: 24_000 },
      [tx("2026-08-12", 9_000, "COMCAST CABLE"), lower],
    );
    expect(check).toMatchObject({
      status: "confirmed",
      cents: 24_000,
      percent: VERIFIED_PERCENT.bill_dropped,
      evidence: [lower.id],
    });
  });
  it("isn't seen after two full bills", () => {
    const check = verifyWatch(
      watch,
      { startedOn: START, asOf: "2026-10-15", expectedCents: 24_000 },
      [tx("2026-09-12", 9_000, "COMCAST CABLE"), tx("2026-10-12", 9_000, "COMCAST CABLE")],
    );
    expect(check.status).toBe("not_seen");
  });
});

describe("money that should come back", () => {
  const watch = {
    kind: "refund" as const,
    payees: [{ description: "AMAZON MKTP US*2K4L91", amountCents: 4_500 }],
  };
  it("confirms a credit from the payee once (not a year of it)", () => {
    const back = tx("2026-08-20", -4_500, "AMAZON MKTP US*9ZZ1");
    expect(
      verifyWatch(watch, { startedOn: START, asOf: "2026-08-25", expectedCents: 4_500 }, [back]),
    ).toMatchObject({ status: "confirmed", cents: 4_500, yearly: false, evidence: [back.id] });
  });
  it("isn't seen once its window is over", () => {
    const asOf = addDays(START, WATCH_DAYS.refund + 1);
    expect(verifyWatch(watch, { startedOn: START, asOf, expectedCents: 4_500 }, []).status).toBe(
      "not_seen",
    );
  });
});

describe("fees that should stop", () => {
  const watch = {
    kind: "fee_stops" as const,
    pfcs: ["BANK_FEES_OVERDRAFT_FEES"],
    monthlyCents: 3_500,
  };
  it("waits for the comparison window", () => {
    expect(
      verifyWatch(watch, { startedOn: START, asOf: "2026-09-01", expectedCents: 42_000 }, []),
    ).toEqual({ status: "waiting" });
  });
  it("confirms none since, and partly when there are fewer", () => {
    const asOf = "2026-10-20";
    expect(verifyWatch(watch, { startedOn: START, asOf, expectedCents: 42_000 }, [])).toMatchObject(
      {
        status: "confirmed",
        cents: 42_000,
        percent: VERIFIED_PERCENT.fees_stopped,
      },
    );
    const one = tx("2026-09-01", 3_500, "OVERDRAFT FEE", "BANK_FEES_OVERDRAFT_FEES");
    expect(
      verifyWatch(watch, { startedOn: START, asOf, expectedCents: 42_000 }, [one]),
    ).toMatchObject({
      status: "partial",
      percent: VERIFIED_PERCENT.fees_fewer,
      evidence: [one.id],
    });
  });
  it("isn't seen when as many fees come", () => {
    const fees = ["2026-08-20", "2026-09-05", "2026-09-25"].map((d) =>
      tx(d, 3_500, "OVERDRAFT FEE", "BANK_FEES_OVERDRAFT_FEES"),
    );
    expect(
      verifyWatch(watch, { startedOn: START, asOf: "2026-10-20", expectedCents: 42_000 }, fees)
        .status,
    ).toBe("not_seen");
  });
});

describe("what to watch", () => {
  it("reads only well-formed watches back from a row", () => {
    expect(
      asWatch({ kind: "refund", payees: [{ description: "X", amountCents: 1 }] }),
    ).not.toBeNull();
    expect(asWatch({ kind: "refund", payees: [] })).toBeNull();
    expect(asWatch({ kind: "nope" })).toBeNull();
    expect(asWatch(null)).toBeNull();
  });

  it("builds one from a finding card's evidence, or none when transactions can't show it", () => {
    const stream = {
      merchant: "Netflix",
      frequency: "MONTHLY",
      lastAmountCents: 1_549,
      charges: [{ id: "a", date: "2026-08-01", amountCents: 1_549, description: "NETFLIX.COM" }],
    };
    expect(watchOfFinding("subscription_review", stream)).toEqual({
      kind: "charge_stops",
      payees: [{ description: "NETFLIX.COM", amountCents: 1_549, perYear: 12 }],
    });
    expect(watchOfFinding("price_increase", stream)).toEqual({
      kind: "bill_drops",
      payees: [{ description: "NETFLIX.COM", beforeCents: 1_549, perYear: 12 }],
    });
    expect(
      watchOfFinding("duplicate_charge", { refundCents: 2_000, charges: [stream.charges[0]] }),
    ).toEqual({ kind: "refund", payees: [{ description: "NETFLIX.COM", amountCents: 2_000 }] });
    expect(
      watchOfFinding("bank_fees", {
        totalCents: 12_000,
        transactions: [{ category: "BANK_FEES_OVERDRAFT_FEES" }],
      }),
    ).toEqual({ kind: "fee_stops", pfcs: ["BANK_FEES_OVERDRAFT_FEES"], monthlyCents: 1_000 });
    expect(watchOfFinding("idle_cash", {})).toBeNull();
  });
});

// Debugger 10-30: a double charge marked done read "Charged twice? $46.18 at Doordash, about
// $46.18/yr" on /saved and the month's close. Money back comes once.
describe("outcomeYearly", () => {
  it("never counts a refund as a yearly saving", () => {
    const refund = {
      kind: "refund",
      payees: [{ description: "DOORDASH*TACOS", amountCents: 4618 }],
    };
    expect(outcomeYearly(refund, true)).toBe(false);
  });

  it("keeps what was stored for anything else", () => {
    const stops = {
      kind: "charge_stops",
      payees: [{ description: "HULU", amountCents: 1899, perYear: 12 }],
    };
    expect(outcomeYearly(stops, true)).toBe(true);
    expect(outcomeYearly(stops, false)).toBe(false);
    expect(outcomeYearly(null, true)).toBe(true);
  });
});

// Review 10-31: a six-month premium's review card made no watch ("Mark done" never verified),
// because the frequency wasn't one the watch knew.
describe("watchOfFinding, for a charge every six months", () => {
  it("watches a six-month premium like any other charge", () => {
    expect(
      watchOfFinding("subscription_review", {
        frequency: "SEMIANNUALLY",
        lastAmountCents: 61_240,
        charges: [{ description: "GEICO AUTO PAY 6MO PREMIUM", amountCents: 61_240 }],
      }),
    ).toEqual({
      kind: "charge_stops",
      payees: [{ description: "GEICO AUTO PAY 6MO PREMIUM", amountCents: 61_240, perYear: 2 }],
    });
  });
});
