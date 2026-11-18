import { describe, expect, it } from "vitest";
import { fromPlaidStream } from "./streams";
import type { DetectionRecurringStream } from "./types";

// Debugger 11-17 (r338, a Plaid sandbox checking account on a phone): Spending & bills' next month
// of bills listed "Dec 1 · ONLINE TRANSFER TO PARKSIDE LEASING REF #IB7Q2M" beside "Netflix" and
// "Spotify". Plaid had named the stream by the bank's own line; an uploaded line is named without
// its reference code and capitals. A name Plaid wrote stays, capitals and all ("GEICO").

const stream = (merchantName: string | null): DetectionRecurringStream => ({
  id: "s1",
  accountId: "a1",
  plaidStreamId: "p1",
  merchantName,
  frequency: "MONTHLY",
  lastAmountCents: 95_000,
  averageAmountCents: 95_000,
  lastDate: "2026-11-01",
  status: "MATURE",
  isActive: true,
  pfcPrimary: "RENT_AND_UTILITIES",
  pfcDetailed: "RENT_AND_UTILITIES_RENT",
  transactionIds: [],
});

const plaid = (name: string | null) => fromPlaidStream(stream(name), new Map());

describe("a recurring charge Plaid names", () => {
  it("is named as Jane names the bank's line when Plaid gave that line", () => {
    const name = plaid("ONLINE TRANSFER TO PARKSIDE LEASING REF #IB7Q2M").merchant;
    expect(name).not.toContain("#IB7Q2M");
    expect(name).toMatch(/^Online Transfer To Parkside Leasing|^Parkside Leasing/);
  });

  it("keeps a name Plaid wrote, and the key either way", () => {
    expect(plaid("Netflix").merchant).toBe("Netflix");
    expect(plaid("GEICO").merchant).toBe("GEICO");
    expect(plaid("PG&E").merchant).toBe("PG&E");
    expect(plaid("ONLINE TRANSFER TO PARKSIDE LEASING REF #IB7Q2M").merchantKey).toBe(
      plaid("Online Transfer To Parkside Leasing Ref #IB7Q2M").merchantKey,
    );
  });
});
