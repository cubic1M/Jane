import { describe, expect, it } from "vitest";
import { validateOption, type OptionInput } from "./switch-options";

const base: OptionInput = {
  kind: "plan",
  category: "phone",
  merchant: "",
  provider: "Pine Mobile",
  name: "Pine Unlimited",
  monthly: "35",
  apy: "",
  contractMonths: "",
  fee: "",
  minimumBalance: "",
  includes: "Unlimited talk, text and data",
  givesUp: "",
  signUpUrl: "https://pine.example/join",
  sourceUrl: "https://pine.example/plans",
  checkedAt: "2026-10-18",
  reviewed: true,
};
const TODAY = "2026-10-18";

describe("options the team adds", () => {
  it("accepts a plan with its price, source and date", () => {
    const result = validateOption(base, TODAY);
    expect(result).toMatchObject({
      ok: true,
      data: {
        kind: "plan",
        category: "phone",
        merchantKey: "pine mobile",
        monthlyCents: 3_500,
        contractMonths: 0,
        oneTimeFeeCents: 0,
        givesUp: null,
        checkedAt: new Date("2026-10-18T00:00:00Z"),
      },
    });
    expect(result.ok && result.data.reviewedAt).toBeInstanceOf(Date);
    expect(validateOption({ ...base, reviewed: false }, TODAY)).toMatchObject({
      ok: true,
      data: { reviewedAt: null },
    });
  });

  it("ties a tier to its service, and a savings account to its rate", () => {
    expect(
      validateOption({ ...base, kind: "tier", merchant: "NETFLIX.COM", monthly: "7.99" }, TODAY),
    ).toMatchObject({
      ok: true,
      data: { merchantKey: "netflix", category: null, monthlyCents: 799 },
    });
    expect(
      validateOption(
        { ...base, kind: "savings", monthly: "", apy: "4.1%", minimumBalance: "10,000" },
        TODAY,
      ),
    ).toMatchObject({
      ok: true,
      data: {
        category: "savings",
        apyBps: 410,
        monthlyCents: null,
        minimumBalanceCents: 1_000_000,
      },
    });
  });

  it.each([
    [{ kind: "insurance" }, "plan, a tier or a savings"],
    [{ category: "insurance" }, "which bill"],
    [{ kind: "tier", merchant: "" }, "cheaper tier of"],
    [{ monthly: "" }, "price a month"],
    [{ kind: "savings", apy: "45" }, "yearly rate"],
    [{ contractMonths: "1.5" }, "whole number"],
    [{ fee: "5000" }, "one-time fee"],
    [{ sourceUrl: "http://pine.example/plans" }, "https page"],
    [{ signUpUrl: "javascript:alert(1)" }, "sign-up link"],
    [{ checkedAt: "2026-12-01" }, "future"],
    [{ provider: "" }, "provider"],
  ] as [Partial<OptionInput>, string][])("refuses %j", (change, message) => {
    const result = validateOption({ ...base, ...change }, TODAY);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.message).toContain(message);
  });
});
