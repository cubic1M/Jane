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
        payModel: "none",
        lines: [],
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
    // Unpaid, so no revenue per conversion (./referrals-unpaid.test.ts).
    expect(
      validatePartner(
        input({ actionType: "insurance_reshop", active: false, revenuePerConversion: "" }),
      ),
    ).toMatchObject({ ok: true });
  });

  it("never lets an insurance partner pay per policy sold, and checks the lines", () => {
    expect(
      validatePartner(
        input({ actionType: "insurance_reshop", active: false, payModel: "per_policy" }),
      ),
    ).toMatchObject({ ok: false, message: expect.stringContaining("per policy") });
    expect(validatePartner(input({ payModel: "per_sale" }))).toMatchObject({ ok: false });
    expect(
      validatePartner(
        input({
          actionType: "insurance_reshop",
          active: false,
          revenuePerConversion: "",
          lines: "Auto, home, auto",
        }),
      ),
    ).toMatchObject({ ok: true, data: { lines: ["auto", "home"] } });
    expect(validatePartner(input({ lines: "boat" }))).toMatchObject({ ok: false });
  });
});

describe("partnerAllowed by pay model", () => {
  it("keeps insurance off before counsel, and per policy off for good", async () => {
    for (const model of ["none", "flat_click", "flat_lead", "per_quote", "per_policy"] as const) {
      expect(partnerAllowed("insurance_reshop", model, "NY"), model).toBe(false);
    }
    // Other referrals don't change.
    expect(partnerAllowed("move_idle_cash", "per_policy", "NY")).toBe(true);
  });

  it("with counsel's answer: unpaid anywhere, paid only where approved for that pay model", async () => {
    vi.resetModules();
    vi.doMock("@/config/referrals", async (importOriginal) => {
      const original = await importOriginal<typeof import("@/config/referrals")>();
      return {
        ...original,
        COUNSEL_INSURANCE_REFERRALS: {
          ...original.COUNSEL_INSURANCE_REFERRALS,
          approved: true,
          approvedStates: { flat_click: ["NY"] },
        },
      };
    });
    const { partnerAllowed: allowed } = await import("./referrals");
    expect(allowed("insurance_reshop", "none", "CA")).toBe(true);
    expect(allowed("insurance_reshop", "flat_click", "NY")).toBe(true);
    expect(allowed("insurance_reshop", "flat_click", "CA")).toBe(false);
    expect(allowed("insurance_reshop", "per_quote", "NY")).toBe(false);
    expect(allowed("insurance_reshop", "per_policy", "NY")).toBe(false);
    vi.doUnmock("@/config/referrals");
  });
});
