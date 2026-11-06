import { describe, expect, it } from "vitest";
import { checkGuardrails, misstatesDepositInsurance } from "./guardrails";

// Security round 48: after #1532 and #1542, Jane could still be called an FDIC member, an account
// named for Jane could still be called insured, and an investment could still be called
// "federally insured". Jane isn't a bank and holds nobody's money (12 CFR 328), in every profile.
describe("deposit insurance said of Jane or an investment, other ways", () => {
  it.each([
    "Jane, Member FDIC.",
    "Jane is a member of the FDIC.",
    "Jane accounts are FDIC insured.",
    "Your Jane balance is FDIC-insured.",
    "Jane's cash sweep is FDIC eligible.",
    "Money held by Jane is insured up to $250,000.",
    "Your T-bills are federally insured.",
  ])("stops %j", (text) => {
    expect(misstatesDepositInsurance(text)).toBe(true);
    expect(checkGuardrails(text, [25_000_000], undefined, "demo_advice")).toEqual({
      ok: false,
      issues: ["deposit_insurance"],
    });
  });

  it.each([
    "Jane isn't a bank and isn't a member of the FDIC.",
    "Jane accounts are not FDIC insured: your money stays at your bank.",
    "Nothing is held by Jane; your bank is insured.",
    "Your Ally savings are FDIC insured.",
    "Your credit union savings are federally insured.",
    "Treasuries aren't federally insured; they're backed by the U.S. government.",
    "Your bank is a Member FDIC bank.",
  ])("lets the true sentence %j through", (text) => {
    expect(misstatesDepositInsurance(text)).toBe(false);
  });
});
