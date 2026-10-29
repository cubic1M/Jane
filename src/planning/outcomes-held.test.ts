import { describe, expect, it } from "vitest";
import { HELD_DAYS, STOP_GRACE_DAYS } from "@/config/outcomes";
import { addDays } from "@/detection/units";
import { checkHeld, verifyWatch, type OutcomeTx } from "./outcomes";

// The ledger's later states (src/planning/ledger.ts): a stopped charge or stopped fees is an
// absence, so it is verified only once the statements reach past it; a verified saving is Held
// when it is still true HELD_DAYS later, and lapses the moment it comes back. Each with the lines
// that show it.

let n = 0;
const tx = (
  date: string,
  amountCents: number,
  description: string,
  pfc: string | null = null,
  accountId = "checking",
): OutcomeTx => ({ id: `h${(n += 1)}`, date, amountCents, description, pfc, accountId });

const START = "2026-08-10";
const HULU = {
  kind: "charge_stops" as const,
  payees: [{ description: "HULU 877-8244858", amountCents: 1_799, perYear: 12 }],
};
const hulu = ["2026-06-03", "2026-07-03", "2026-08-03"].map((d) =>
  tx(d, 1_799, "HULU 877-8244858"),
);

describe("Done to Verified needs a newer statement", () => {
  it("waits while the statements stop before the due day, then says why it wasn't seen", () => {
    const about = { startedOn: START, expectedCents: 21_588 };
    const stale = { checking: "2026-08-20" };
    expect(
      verifyWatch(HULU, { ...about, asOf: "2026-09-20", coveredThrough: stale }, hulu),
    ).toEqual({ status: "waiting" });
    const late = verifyWatch(HULU, { ...about, asOf: "2026-11-01", coveredThrough: stale }, hulu);
    expect(late).toMatchObject({ status: "not_seen" });
    if (late.status !== "not_seen") throw new Error();
    expect(late.proof).toMatch(/^No statement after Sep 2, when the next charge was due/);
  });

  it("verifies once a statement reaches past the due day and its grace", () => {
    const reach = addDays("2026-09-02", STOP_GRACE_DAYS + 1);
    expect(
      verifyWatch(
        HULU,
        {
          startedOn: START,
          asOf: "2026-09-20",
          expectedCents: 21_588,
          coveredThrough: { checking: reach },
        },
        hulu,
      ),
    ).toMatchObject({ status: "confirmed", evidence: [hulu[2].id] });
  });

  it("counts fees only once every account they came from reaches the window's end", () => {
    const watch = {
      kind: "fee_stops" as const,
      pfcs: ["BANK_FEES_OVERDRAFT_FEES"],
      monthlyCents: 3_500,
    };
    const before = tx("2026-07-20", 3_500, "OVERDRAFT FEE", "BANK_FEES_OVERDRAFT_FEES");
    const about = { startedOn: START, asOf: "2026-10-20", expectedCents: 42_000 };
    const stale = { coveredThrough: { checking: "2026-09-01" } };
    expect(verifyWatch(watch, { ...about, asOf: "2026-10-09", ...stale }, [before])).toEqual({
      status: "waiting",
    });
    // Past the window with no statement for it: not seen, and it says why.
    expect(verifyWatch(watch, { ...about, ...stale }, [before])).toMatchObject({
      status: "not_seen",
      proof: "No statement reaching Oct 9 to count the fees against.",
    });
    expect(
      verifyWatch(watch, { ...about, coveredThrough: { checking: "2026-10-19" } }, [before]),
    ).toMatchObject({ status: "confirmed" });
  });
});

describe("Verified to Held, or back", () => {
  const verifiedOn = "2026-09-20";
  const heldOn = addDays(verifiedOn, HELD_DAYS);

  it("a stopped charge: waiting until the statements reach the held day, then held", () => {
    const about = { startedOn: START, verifiedOn, confirmedCents: 21_588 };
    expect(
      checkHeld(
        HULU,
        { ...about, asOf: heldOn, coveredThrough: { checking: addDays(heldOn, -1) } },
        hulu,
      ),
    ).toEqual({ status: "waiting" });
    const held = checkHeld(
      HULU,
      { ...about, asOf: heldOn, coveredThrough: { checking: heldOn } },
      hulu,
    );
    expect(held).toMatchObject({ status: "held", evidence: [hulu[2].id] });
    if (held.status !== "held") throw new Error();
    expect(held.proof).toMatch(/^No charge since \$17\.99 on Aug 3, through Dec 19\./);
  });

  it("a stopped charge that comes back lapses at once, with that charge", () => {
    const again = tx("2026-10-03", 1_799, "HULU 877-8244858");
    const check = checkHeld(
      HULU,
      { startedOn: START, verifiedOn, asOf: "2026-10-05", confirmedCents: 21_588 },
      [...hulu, again],
    );
    expect(check).toMatchObject({ status: "lapsed", evidence: [again.id] });
  });

  it("a lower bill: held while bills stay lower near the held day; lapsed when it goes back up", () => {
    const watch = {
      kind: "bill_drops" as const,
      payees: [{ description: "COMCAST CABLE", beforeCents: 9_000, perYear: 12 }],
    };
    const lower = ["2026-09-12", "2026-10-12", "2026-11-12", "2026-12-12"].map((d) =>
      tx(d, 7_000, "COMCAST CABLE"),
    );
    const about = { startedOn: START, verifiedOn, confirmedCents: 24_000 };
    expect(checkHeld(watch, { ...about, asOf: addDays(heldOn, -1) }, lower)).toEqual({
      status: "waiting",
    });
    expect(checkHeld(watch, { ...about, asOf: heldOn }, lower.slice(0, 2))).toEqual({
      status: "waiting",
    });
    expect(checkHeld(watch, { ...about, asOf: heldOn }, lower)).toMatchObject({
      status: "held",
      evidence: [lower[3].id],
    });
    const back = tx("2026-11-12", 9_000, "COMCAST CABLE");
    expect(
      checkHeld(watch, { ...about, asOf: "2026-11-15" }, [lower[0], lower[1], back]),
    ).toMatchObject({
      status: "lapsed",
      evidence: [back.id],
    });
  });

  it("a refund: held when not taken back by the held day; lapsed when it is", () => {
    const watch = {
      kind: "refund" as const,
      payees: [{ description: "AMAZON MKTP US*2K4L91", amountCents: 4_500 }],
    };
    const back = tx("2026-08-20", -4_500, "AMAZON MKTP US*9ZZ1");
    const about = { startedOn: START, verifiedOn: "2026-08-20", confirmedCents: 4_500 };
    const due = addDays("2026-08-20", HELD_DAYS);
    expect(
      checkHeld(watch, { ...about, asOf: due, coveredThrough: { checking: due } }, [back]),
    ).toMatchObject({ status: "held", evidence: [back.id] });
    const taken = tx("2026-09-02", 4_500, "AMAZON MKTP US*9ZZ1");
    expect(
      checkHeld(watch, { ...about, asOf: due, coveredThrough: { checking: due } }, [back, taken]),
    ).toMatchObject({ status: "lapsed", evidence: [taken.id] });
  });

  it("fees: held when most of the verified saving is still there; lapsed when they're back", () => {
    const watch = {
      kind: "fee_stops" as const,
      pfcs: ["BANK_FEES_OVERDRAFT_FEES"],
      monthlyCents: 3_500,
    };
    const about = {
      startedOn: START,
      verifiedOn,
      asOf: heldOn,
      confirmedCents: 42_000,
      coveredThrough: { checking: heldOn },
    };
    const before = tx("2026-07-20", 3_500, "OVERDRAFT FEE", "BANK_FEES_OVERDRAFT_FEES");
    expect(checkHeld(watch, about, [before])).toMatchObject({ status: "held", evidence: [] });
    const again = ["2026-10-05", "2026-11-05", "2026-12-05"].map((d) =>
      tx(d, 3_500, "OVERDRAFT FEE", "BANK_FEES_OVERDRAFT_FEES"),
    );
    expect(checkHeld(watch, about, [before, ...again])).toMatchObject({
      status: "lapsed",
      evidence: again.map((t) => t.id),
    });
    expect(
      checkHeld(watch, { ...about, coveredThrough: { checking: addDays(heldOn, -1) } }, [before]),
    ).toEqual({ status: "waiting" });
  });
});
