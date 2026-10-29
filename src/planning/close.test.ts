import { describe, expect, it } from "vitest";
import { CLOSE_CHIPS_MAX } from "@/config/close";
import type { CheckLine } from "@/detection/checkup";
import { closeOf, monthStep, type CloseChange, type CloseEntry } from "./close";

// The monthly close's parts, chips and the all-good case, from the ledger and the month's
// changes.

const entry = (over: Partial<CloseEntry> & Pick<CloseEntry, "key" | "state">): CloseEntry => ({
  title: over.key,
  cents: 10_000,
  yearly: true,
  confidencePercent: 80,
  foundOn: null,
  actedOn: null,
  verifiedOn: null,
  heldOn: null,
  ...over,
});
const change = (over: Partial<CloseChange> & Pick<CloseChange, "key" | "kind">): CloseChange => ({
  date: "2026-10-12",
  title: "Comcast went from $80.00 to $95.00.",
  amountCents: 9_500,
  usualCents: 8_000,
  sure: "84%",
  ...over,
});
const line = (status: CheckLine["status"]): CheckLine => ({
  type: "bank_fees",
  label: "Bank fees",
  status,
  line: "None in 3 months",
  detail: "x",
});

const MONTH = "2026-10";

describe("the monthly close", () => {
  const entries = [
    entry({ key: "found-oct", state: "estimated", foundOn: "2026-10-03", cents: 21_600 }),
    entry({ key: "found-sep", state: "estimated", foundOn: "2026-09-20", cents: 5_000 }),
    entry({ key: "did-oct", state: "done", foundOn: "2026-09-01", actedOn: "2026-10-05" }),
    entry({
      key: "verified-oct",
      state: "verified",
      actedOn: "2026-09-02",
      verifiedOn: "2026-10-09",
      cents: 18_000,
    }),
    entry({
      key: "held-oct",
      state: "held",
      verifiedOn: "2026-07-15",
      heldOn: "2026-10-13",
      cents: 4_500,
    }),
    entry({ key: "verified-aug", state: "verified", verifiedOn: "2026-08-01" }),
    entry({ key: "lapsed", state: "not_seen", verifiedOn: "2026-10-02" }),
  ];
  const changes = [
    change({ key: "bill", kind: "bill_jump" }),
    change({ key: "fee", kind: "new_fee", amountCents: 3_500, usualCents: null, sure: "90%" }),
    change({ key: "old", kind: "renewal", date: "2026-09-28" }),
  ];
  const close = closeOf({
    month: MONTH,
    today: "2026-11-02",
    entries,
    changes,
    checkup: [line("found"), line("passed"), line("not_enough_data")],
  });

  it("puts each entry in the parts of the month it moved in", () => {
    expect(close.found.map((e) => e.key)).toEqual(["found-oct"]);
    expect(close.did.map((e) => e.key)).toEqual(["did-oct"]);
    // Verified and held this month, the biggest first; a lapsed one never counts.
    expect(close.verified.map((e) => e.key)).toEqual(["verified-oct", "held-oct"]);
    expect(close.verifiedCents).toBe(22_500);
    expect(close.changed.map((c) => c.key)).toEqual(["bill", "fee"]);
    // Still open: whatever is estimated or done now, whenever it was found.
    expect(close.open.map((e) => e.key)).toEqual(["found-oct", "did-oct", "found-sep"]);
    expect(close.soFar).toBe(false);
    expect(close.quiet).toBe(false);
    expect(close.allGood).toBe(false);
  });

  it("has at most three chips, the biggest dollars first, each with how sure", () => {
    expect(close.chips.length).toBeLessThanOrEqual(CLOSE_CHIPS_MAX);
    expect(close.chips).toEqual([
      { label: "New fee", figure: "$35", sure: "90%", href: "#changed" },
      { label: "Still to do", figure: "$216/yr", sure: "80%", href: "#open" },
      { label: "Bill jumped", figure: "+$15", sure: "84%", href: "#changed" },
    ]);
  });

  it("leads with the checkup when nothing was wrong", () => {
    const quiet = closeOf({
      month: MONTH,
      today: "2026-10-20",
      entries: [entries[5]],
      changes: [],
      checkup: [line("passed"), line("passed"), line("not_enough_data")],
    });
    expect(quiet).toMatchObject({ quiet: true, allGood: true });
    expect(quiet.soFar).toBe(true);
    expect(quiet.chips).toEqual([]);
    expect(quiet.checkup).toMatchObject({ found: 0, passed: 2, notEnoughData: 1 });
  });

  it("is quiet but not all good when something is still open or a check found something", () => {
    const open = closeOf({
      month: MONTH,
      today: "2026-11-02",
      entries: [entries[1]],
      changes: [],
      checkup: [line("passed")],
    });
    expect(open).toMatchObject({ quiet: true, allGood: false });
    const flagged = closeOf({
      month: MONTH,
      today: "2026-11-02",
      entries: [],
      changes: [],
      checkup: [line("found")],
    });
    expect(flagged).toMatchObject({ quiet: true, allGood: false });
  });

  it("steps months across years", () => {
    expect(monthStep("2026-01", -1)).toBe("2025-12");
    expect(monthStep("2026-12", 1)).toBe("2027-01");
  });
});
