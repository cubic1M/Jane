import { describe, expect, it } from "vitest";
import { checkGuardrails } from "./guardrails";

// Chat policy round 60 (11-17): what a business has to do or can't do, a price cap, buyers said
// unable to get refunds, a fee said not to be owed, a fine said to stay out of collections, a money
// order said to be refundable, prepaid money called protected, a prize fee called normal, payments
// said to build credit, costs said to be covered and a deposit said to earn interest, on any
// account. Crowdfunding money said not to be taxed is tax advice, so real accounts only.
const amounts = [500, 1549, 9000, 40000];
const real = (text: string) => checkGuardrails(text, amounts, undefined, "standard");
const demo = (text: string) => checkGuardrails(text, amounts, undefined, "demo_advice");

describe("business duty, cap, collections, money order, prize and credit claims on any account", () => {
  it.each([
    "The shop has to give you your old parts back.",
    "The tow company can't keep your car for the fee.",
    "The contractor can't ask for more than a third up front.",
    "The daycare must refund the weeks you missed.",
    "Your daycare can't raise tuition mid-year.",
    "The funeral home has to give you a price list.",
    "The pawn shop has to hold your item for 30 days.",
    "The HOA must approve your fence.",
    "The title loan company must sell your car for what it's worth and give you the rest.",
    "The ticket price can't be more than face value.",
    "Your GoFundMe donors can't ask for refunds.",
    "You don't owe the tow fee if the sign wasn't posted.",
    "The HOA fine won't go to collections.",
    "A money order can be cancelled for a full refund.",
    "Money orders never bounce.",
    "Your prepaid card money is protected if it's stolen.",
    "You won the sweepstakes; the fee is normal.",
    "Rent-to-own payments build your credit.",
    "Your funeral costs will be covered by Social Security.",
    "Your contractor's insurance covers the broken window.",
    "Your deposit at the pawn shop earns interest.",
  ])("blocks %s", (text) => {
    expect(real(text).ok).toBe(false);
    expect(demo(text).ok).toBe(false);
  });

  it("blocks crowdfunding money said not to be taxed on a real account", () => {
    expect(real("GoFundMe money isn't taxable.").ok).toBe(false);
  });
});

describe("what still passes on a real account", () => {
  it.each([
    "Your Midas repair of $400.00 posted Nov 1.",
    "Ask the mechanic for a written estimate first.",
    "You could ask the daycare how its refunds work.",
    "Your HOA fine of $90.00 posted Nov 1.",
    "Your pawn shop loan of $90.00 arrived Nov 1.",
    "Your money order fee of $5.00 posted Nov 1.",
    "Your Green Dot card load of $90.00 posted Nov 1.",
    "Your Green Dot card is FDIC insured.",
    "Your sweepstakes letter is in your notes.",
    "A secured card can help build your credit if it reports to the bureaus.",
    "Your Ally savings earned $5.00 in interest in October.",
    "Your GoFundMe deposit of $400.00 arrived Nov 1.",
  ])("passes %s", (text) => {
    expect(real(text)).toMatchObject({ ok: true });
  });
});
