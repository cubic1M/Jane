import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ db: {} }));

import { partnerAllowed, validatePartner, type PartnerInput } from "./referrals";

const input = (overrides: Partial<PartnerInput> = {}): PartnerInput => ({
  key: "example-bank",
  name: "Example Bank",
  actionType: "move_idle_cash",
  disclosure: "We may earn a referral fee from Example Bank if you open an account.",
  referralUrl: "https://example.com/r/jane",
  allowedStates: "ca, NY ,ny",
  revenuePerConversion: "$40",
  active: true,
  ...overrides,
});

describe("validatePartner", () => {
  it("cleans up states and money", () => {
    expect(validatePartner(input())).toEqual({
      ok: true,
      data: {
        key: "example-bank",
        name: "Example Bank",
        actionType: "move_idle_cash",
        disclosure: "We may earn a referral fee from Example Bank if you open an account.",
        referralUrl: "https://example.com/r/jane",
        allowedStates: ["CA", "NY"],
        revenuePerConversionCents: 4_000,
        active: true,
      },
    });
  });

  it.each([
    [{ disclosure: "   " }, "disclosure"],
    [{ referralUrl: "http://example.com" }, "https"],
    [{ allowedStates: "CA, ZZ" }, "Unknown state: ZZ"],
    [{ actionType: "launder_money" }, "action type"],
    [{ key: "Bad Key!" }, "Key"],
    [{ revenuePerConversion: "-5" }, "Revenue"],
  ])("rejects %j", (overrides, message) => {
    const result = validatePartner(input(overrides));
    expect(!result.ok && result.message).toContain(message);
  });

  it("won't turn an insurance partner on before counsel's answer is recorded", () => {
    expect(partnerAllowed("insurance_reshop")).toBe(false);
    expect(validatePartner(input({ actionType: "insurance_reshop" }))).toMatchObject({
      ok: false,
      message: expect.stringContaining("counsel"),
    });
    // It can be added switched off, ready for when it's allowed.
    expect(validatePartner(input({ actionType: "insurance_reshop", active: false }))).toMatchObject(
      {
        ok: true,
      },
    );
  });
});
