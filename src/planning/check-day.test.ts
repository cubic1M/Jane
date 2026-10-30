import { describe, expect, it } from "vitest";
import { FEE_COMPARE_DAYS, STOP_GRACE_DAYS, WATCH_DAYS } from "@/config/outcomes";
import { addDays } from "@/detection/units";
import { checkWords } from "./ledger";
import { checksOn, verifyWatch, type OutcomeTx } from "./outcomes";

// A Done saving says when it will be checked (founder, 10-30: "Hulu: done, we'll check on Nov 5"),
// and that day is the one verifyWatch first can verify it on.

let n = 0;
const tx = (date: string, amountCents: number, description: string): OutcomeTx => ({
  id: `c${(n += 1)}`,
  date,
  amountCents,
  description,
  pfc: null,
  accountId: "checking",
});
const START = "2026-08-10";
const HULU = {
  kind: "charge_stops" as const,
  payees: [{ description: "HULU 877-8244858", amountCents: 1_799, perYear: 12 }],
};
const hulu = ["2026-06-03", "2026-07-03", "2026-08-03"].map((d) =>
  tx(d, 1_799, "HULU 877-8244858"),
);

describe("when a Done saving is checked", () => {
  it("a stopped charge: the day after its next due day and the bank's grace", () => {
    const check = checksOn(HULU, START, hulu);
    expect(check).toEqual({ on: addDays("2026-09-02", STOP_GRACE_DAYS + 1), until: false });
    // The day before, it can't verify yet; on the day, with a statement that far, it does.
    const about = { startedOn: START, expectedCents: 21_588 };
    const before = addDays(check!.on, -1);
    expect(
      verifyWatch(HULU, { ...about, asOf: before, coveredThrough: { checking: before } }, hulu)
        .status,
    ).toBe("waiting");
    expect(
      verifyWatch(
        HULU,
        { ...about, asOf: check!.on, coveredThrough: { checking: check!.on } },
        hulu,
      ).status,
    ).toBe("confirmed");
  });

  it("the earliest payee; none without a charge before acting", () => {
    const two = {
      kind: "charge_stops" as const,
      payees: [...HULU.payees, { description: "SPOTIFY USA", amountCents: 1_199, perYear: 12 }],
    };
    const spotify = tx("2026-07-20", 1_199, "SPOTIFY USA");
    expect(checksOn(two, START, [...hulu, spotify])?.on).toBe(
      addDays("2026-08-19", STOP_GRACE_DAYS + 1),
    );
    expect(checksOn(HULU, START, [])).toBeNull();
  });

  it("a bill on its next bill day, fees at the end of their window, a refund until its watch ends", () => {
    const bill = {
      kind: "bill_drops" as const,
      payees: [{ description: "COMCAST CABLE", beforeCents: 9_000, perYear: 12 }],
    };
    expect(checksOn(bill, START, [tx("2026-08-01", 9_000, "COMCAST CABLE")])).toEqual({
      on: "2026-08-31",
      until: false,
    });
    expect(
      checksOn(
        { kind: "fee_stops", pfcs: ["BANK_FEES_OVERDRAFT_FEES"], monthlyCents: 3_500 },
        START,
        [],
      ),
    ).toEqual({ on: addDays(START, FEE_COMPARE_DAYS), until: false });
    expect(
      checksOn(
        { kind: "refund", payees: [{ description: "AMAZON", amountCents: 4_500 }] },
        START,
        [],
      ),
    ).toEqual({ on: addDays(START, WATCH_DAYS.refund), until: true });
  });

  it("says it in a few words, and what's missing once the day has passed", () => {
    expect(checkWords({ on: "2026-11-05", until: false }, "2026-10-30")).toBe(
      "we'll check on Nov 5",
    );
    expect(checkWords({ on: "2026-11-05", until: false }, "2026-11-05")).toBe(
      "we'll check on Nov 5",
    );
    expect(checkWords({ on: "2026-11-05", until: false }, "2026-11-09")).toBe(
      "we'll check once a statement after Nov 5 is in",
    );
    expect(checkWords({ on: "2026-12-09", until: true }, "2026-10-30")).toBe(
      "we'll watch for it until Dec 9",
    );
    expect(checkWords(null, "2026-10-30")).toBeNull();
  });
});
