import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));

import { PEOPLE } from "@/config/people";
import { EFTPS_INDIVIDUALS } from "@/config/tax";
import { recommendsAChoice } from "@/lib/guardrails";
import { buildProfile, type ProfileInput } from "@/profile/build";
import { inputFor } from "@/profile/sample";
import { EFTPS_DETECTORS } from "./eftps";
import { runDetectors } from "./index";

// Connectors roadmap round 16: EFTPS is closing to individuals.

const withPayments = (descriptions: string[]) => {
  const base = inputFor("freelancer");
  const account = base.accounts[0]!.id;
  const data: ProfileInput = {
    ...base,
    transactions: [
      ...base.transactions.filter((t) => !EFTPS_INDIVIDUALS.match.test(t.description)),
      ...descriptions.map((description, i) => ({
        date: `2026-0${i + 4}-15`,
        amountCents: 150_000,
        description,
        pfc: "GOVERNMENT_AND_NON_PROFIT_TAX_PAYMENT",
        accountId: account,
      })),
    ],
  };
  return runDetectors({ profile: buildProfile(data), data }, EFTPS_DETECTORS)[0] ?? null;
};

describe("the EFTPS move card", () => {
  it("asks someone paying through EFTPS to move to the IRS Online Account", () => {
    const s = withPayments(["EFTPS IRS USATAXPYMT", "IRS EFTPS 1040ES"])!;
    expect(s.topic).toBe("eftps_move");
    expect(s.worthCents).toBe(300_000);
    expect(s.worthKind).toBe("risk");
    expect(s.why).toContain("2 tax payments through EFTPS, $3,000.00 in all");
    expect(s.why).toContain("October 17, 2025");
    expect(s.why).toContain("a business's payments, EFTPS stays open");
    expect(s.more?.[0]?.href).toBe("https://www.irs.gov/payments/your-online-account");
    expect(s.confidence.reason).toContain("EFTPS payments");
    expect(recommendsAChoice(`${s.title} ${s.short} ${s.why}`)).toBe(false);
  });

  it("says nothing for IRS payments made another way, or none at all", () => {
    expect(withPayments(["IRS USATAXPYMT DIRECT PAY"])).toBeNull();
    expect(withPayments([])).toBeNull();
  });

  it("shows on real accounts with CONNECTORS off: facts and a link, no partner", () => {
    vi.stubEnv("CONNECTORS", "");
    expect(withPayments(["EFTPS"])).not.toBeNull();
    vi.unstubAllEnvs();
  });

  it("reads EFTPS as a word, not inside another one", () => {
    expect(EFTPS_INDIVIDUALS.match.test("XEFTPSX")).toBe(false);
    expect(EFTPS_INDIVIDUALS.match.test("eftps ach")).toBe(true);
  });

  it("finds it only where the sample people pay through EFTPS", () => {
    const by = PEOPLE.filter((p) => {
      const data = inputFor(p.id);
      return runDetectors({ profile: buildProfile(data), data }, EFTPS_DETECTORS).length > 0;
    }).map((p) => p.id);
    for (const id of by) {
      expect(
        inputFor(id).transactions.some((t) => EFTPS_INDIVIDUALS.match.test(t.description)),
        id,
      ).toBe(true);
    }
  });
});
