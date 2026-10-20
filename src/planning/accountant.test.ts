import { describe, expect, it } from "vitest";
import { COMPLEX_MIN_FACTORS } from "@/config/accountant";
import { complexity, linkState } from "./accountant";

// Spec step 222: when a situation is the kind people usually bring an accountant to (facts
// only), and a link's state.

describe("complexity", () => {
  it("says nothing for a simple return, or for one factor alone", () => {
    expect(complexity({})).toEqual({ factors: [], complex: false, text: null });
    const one = complexity({ rental: true });
    expect(one.complex).toBe(false);
    expect(one.text).toBeNull();
    expect(COMPLEX_MIN_FACTORS).toBe(2);
  });

  it("lists the factors in a fixed order, as facts", () => {
    const c = complexity({ gains: true, self_employed: true, equity: true, states: false });
    expect(c.factors).toEqual(["self_employed", "equity", "gains"]);
    expect(c.complex).toBe(true);
    expect(c.text).toBe(
      "Your taxes include income from self-employment, stock options, RSUs or crypto and large investment gains. People with that mix usually work with an accountant or tax preparer.",
    );
    expect(c.text).not.toMatch(/\byou should\b|\bI recommend\b/i);
  });

  it("works with two", () => {
    expect(complexity({ rental: true, home_sale: true }).text).toBe(
      "Your taxes include rental income and the sale of a home. People with that mix usually work with an accountant or tax preparer.",
    );
  });
});

describe("a link's state", () => {
  const now = new Date("2026-10-19T12:00:00Z");
  it("is active until it expires, expired at the moment it does, and revoked wins", () => {
    const later = new Date("2026-10-20T12:00:00Z");
    expect(linkState({ expiresAt: later, revokedAt: null }, now)).toBe("active");
    expect(linkState({ expiresAt: now, revokedAt: null }, now)).toBe("expired");
    expect(linkState({ expiresAt: new Date("2026-10-01T00:00:00Z"), revokedAt: null }, now)).toBe(
      "expired",
    );
    expect(linkState({ expiresAt: later, revokedAt: new Date("2026-10-19T00:00:00Z") }, now)).toBe(
      "revoked",
    );
    expect(
      linkState(
        {
          expiresAt: new Date("2026-10-01T00:00:00Z"),
          revokedAt: new Date("2026-09-30T00:00:00Z"),
        },
        now,
      ),
    ).toBe("revoked");
  });
});
