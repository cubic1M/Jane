import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));

import { PEOPLE } from "@/config/people";
import { buildProfile, type ProfileInput } from "@/profile/build";
import { inputFor } from "@/profile/sample";
import { BORROWING_POWER_DETECTORS } from "./borrowing-power";

// Spec step 250: what you could borrow, brought unasked to a renter whose pay lenders count and
// who has a down payment saved; never to someone in debt trouble.

const fire = (data: ProfileInput) =>
  BORROWING_POWER_DETECTORS[0].detect({ profile: buildProfile(data), data });

describe("what you could borrow, brought unasked", () => {
  it("reaches Sam, who rents with $11,700 saved, and none of the other seven", () => {
    for (const p of PEOPLE) {
      expect(Boolean(fire(inputFor(p.id))), p.id).toBe(p.id === "freelancer");
    }
  });

  it("says the mortgage that fits, what comparing lenders is worth, and how sure it is", () => {
    const s = fire(inputFor("freelancer"))!;
    expect(s.headline).toMatch(/^Compare lenders before you borrow, save \$[\d,]+ a year$/);
    expect(s.short).toMatch(/a mortgage of about \$[\d,]+\.00 would fit/);
    expect(s.why).toContain("soft pull");
    // Uneven pay: the weakest evidence, said.
    expect(s.confidence).toEqual({
      percent: 60,
      reason: "lenders want two years of tax returns for uneven pay",
    });
    expect(s.action.href).toBe("/loans/borrow");
  });

  // Loans QA: a month's uneven pay moves the mortgage that fits a little; the suggestion holds
  // while the savings cover the down payment on at least half of it, and says how much.
  it("holds for Sam while his savings cover the down payment on half the mortgage", () => {
    const sam = inputFor("freelancer");
    const withCash = (cents: number): ProfileInput => ({
      ...sam,
      accounts: sam.accounts
        .map((a) => (a.type === "depository" ? { ...a, balanceCents: 0 } : a))
        .concat({ id: "cash", type: "depository", subtype: "savings", balanceCents: cents }),
    });
    const full = fire(withCash(2_000_000))!;
    expect(full.why).toMatch(/covers a 3\.5% down payment on that\./);
    const amount = Number(full.short.match(/about \$([\d,]+)\.00/)![1].replace(/,/g, "")) * 100;
    // Enough for half of it: still brought, with the smaller home it covers.
    const half = fire(withCash(Math.ceil((amount * 0.5 * 0.035) / 100_000) * 100_000 + 100_000))!;
    expect(half.why).toMatch(/covers a 3\.5% down payment on up to about \$[\d,]+\.00\./);
    // Less than half: not yet.
    expect(fire(withCash(Math.floor(amount * 0.4 * 0.035)))).toBeNull();
  });

  it("waits for a down payment: Maya rents on a wage with $1,760 in cash", () => {
    const maya = inputFor("renter");
    expect(fire(maya)).toBeNull();
    const saved: ProfileInput = {
      ...maya,
      accounts: maya.accounts.map((a) =>
        a.type === "depository" ? { ...a, balanceCents: a.balanceCents + 1_000_000 } : a,
      ),
    };
    const s = fire(saved)!;
    expect(s).not.toBeNull();
    // A steady wage: the stand-in quotes are the weakest evidence.
    expect(s.confidence.reason).toBe("the offers are stand-in quotes, not a lender's");
  });
});
