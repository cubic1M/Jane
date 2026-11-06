import { describe, expect, it } from "vitest";
import { validatePartner, type PartnerInput } from "./referrals";

// An unpaid insurance partner's card tells the person "Jane isn't an insurance agent and isn't paid
// for this" (PAY_DISCLOSURES.none, connectors roadmap round 14), so its row can't also say Jane
// earns money per conversion: that would make the card's words untrue, and per sale is what round
// 14 bars.

const insurance = (overrides: Partial<PartnerInput> = {}): PartnerInput => ({
  key: "example-insurance",
  name: "Example Insurance",
  actionType: "insurance_reshop",
  disclosure: "Example Insurance is a licensed insurance agency.",
  referralUrl: "https://example.com/compare",
  allowedStates: "VT",
  revenuePerConversion: "",
  payModel: "none",
  active: false,
  ...overrides,
});

describe("an unpaid insurance partner", () => {
  it("can't record revenue per conversion", () => {
    expect(validatePartner(insurance({ revenuePerConversion: "$60" }))).toMatchObject({
      ok: false,
    });
    expect(validatePartner(insurance({ payModel: "", revenuePerConversion: "60" }))).toMatchObject({
      ok: false,
    });
  });

  it("is fine with none, and a paid model or another kind of partner may say what it pays", () => {
    expect(validatePartner(insurance())).toMatchObject({ ok: true });
    expect(
      validatePartner(insurance({ payModel: "flat_lead", revenuePerConversion: "$20" })),
    ).toMatchObject({ ok: true });
    expect(
      validatePartner(
        insurance({
          actionType: "move_idle_cash",
          disclosure: "We may earn a referral fee from Example Bank if you open an account.",
          revenuePerConversion: "$40",
        }),
      ),
    ).toMatchObject({ ok: true });
  });
});
