import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));

import { taxHolding } from "./investment-taxes";
import { profileHolding } from "./profile";

// A holding's security can come back missing although the schema requires one: Prisma reads
// the relation in a second query, and a sync that replaces the demo bank's securities in between
// leaves it null. /insurance crashed on it once ("Cannot read properties of null (reading
// 'ticker')", src/lib/profile.ts). Every reader of a holding's security takes that in its stride.

const holding = {
  accountId: "acc-1",
  securityId: "sec-1",
  quantity: 10,
  valueCents: 125_000,
  costBasisCents: 100_000,
};

describe("a holding without its security", () => {
  it("still counts in the profile at its value, with no ticker and not as cash", () => {
    expect(profileHolding({ ...holding, security: null })).toEqual({
      accountId: "acc-1",
      valueCents: 125_000,
      basisCents: 100_000,
      ticker: null,
      isCash: false,
    });
  });

  it("is left out of the investment taxes, which need the security to match lots", () => {
    expect(taxHolding({ ...holding, security: null })).toEqual([]);
  });

  it("is read as before when the security is there", () => {
    const security = { ticker: "VTI", name: "Total Stock", type: "etf", isCashEquivalent: false };
    expect(profileHolding({ ...holding, security })).toMatchObject({
      ticker: "VTI",
      isCash: false,
    });
    expect(taxHolding({ ...holding, security })).toEqual([
      { ...holding, ticker: "VTI", name: "Total Stock", type: "etf" },
    ]);
    // Cash is still cash in the profile, and still not taxed as a holding.
    const cash = { ...security, ticker: null, type: "cash" };
    expect(profileHolding({ ...holding, security: cash }).isCash).toBe(true);
    expect(taxHolding({ ...holding, security: cash })).toEqual([]);
  });
});
