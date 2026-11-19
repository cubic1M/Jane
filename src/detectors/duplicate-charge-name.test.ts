import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));

import { buildProfile, type ProfileInput } from "@/profile/build";
import { inputFor } from "@/profile/sample";
import { nice } from "./helpers";
import { DETECTORS } from "./index";

// Debug 3, 11-19 (the raw-name invariant over every sweep person): the demo person's double
// charge read "Target 00012345 $64.20 was charged twice." on the dock card and on Spending's tree.
// The card was named from the bank's line, store number and all, though the charge carried
// Jane's own name for it ("Target"), as every other card uses.

const CHECKING = { id: "chk", name: "Checking", type: "depository", subtype: "checking" };
const charge = (date: string, merchantName: string | null) => ({
  date,
  amountCents: 6_420,
  description: "TARGET 00012345",
  pfc: "GENERAL_MERCHANDISE_SUPERSTORES",
  accountId: "chk",
  merchantName,
});

const doubleCharge = (merchantName: string | null) => {
  const base = inputFor("renter");
  const data: ProfileInput = {
    ...base,
    today: "2026-11-12",
    accounts: [{ ...CHECKING, balanceCents: 250_000 }],
    transactions: [charge("2026-11-09", merchantName), charge("2026-11-09", merchantName)],
  };
  return DETECTORS.find((d) => d.topic === "duplicate_charge")!.detect({
    profile: buildProfile(data),
    data,
  });
};

describe("a double charge's card names the merchant", () => {
  it("by Jane's name for it, not the bank's line", () => {
    const card = doubleCharge("Target");
    expect(card?.short).toBe("Target $64.20 was charged twice.");
    expect(card?.why).toBe("Target $64.20 appeared twice within a day.");
  });

  it("without the store number when the line is all there is (an upload)", () => {
    expect(doubleCharge(null)?.short).toBe("Target $64.20 was charged twice.");
    expect(nice("WHOLEFDS MKT 10234")).toBe("Wholefds Mkt");
    expect(nice("TRADER JOE S #123")).toBe("Trader Joe S");
  });
});
