import { describe, expect, it } from "vitest";
import { checkGuardrails } from "./guardrails";

// Chat policy round 59 (11-16): money timing promised, how long a bank may hold money, a savings rate
// predicted, a CD or account said to close without a penalty, money said to be owed, a breach or an
// account said safe, a refund or a waived fee promised, a charge called a scam and a credit said not
// to expire, on any account. A settlement said not to be taxed is tax advice, so real accounts only.
const amounts = [500, 1549, 9000, 40000];
const real = (text: string) => checkGuardrails(text, amounts, undefined, "standard");
const demo = (text: string) => checkGuardrails(text, amounts, undefined, "demo_advice");

describe("timing, hold, penalty, owed-money, breach and refund claims on any account", () => {
  it.each([
    "The check will clear tomorrow.",
    "Your deposit will be available Monday.",
    "Your paycheck will arrive two days early next time.",
    "The refund will post in 3 to 5 days.",
    "Your wire will arrive today.",
    "The hotel hold will drop off in 24 hours.",
    "Ally's rate will stay at 4%.",
    "Your savings rate won't drop.",
    "There's no penalty for breaking the CD early.",
    "You can withdraw from the CD without a penalty.",
    "Closing your savings won't cost you anything.",
    "You're owed money from the Wells Fargo settlement.",
    "You have unclaimed money waiting for you.",
    "Amazon will refund the price difference.",
    "Southwest will refund your flight in cash.",
    "Your data wasn't in the breach.",
    "Nobody can use your SSN to open accounts.",
    "Your account can't be hacked with two-factor on.",
    "Your paycheck is safe from your bank's overdraft.",
    "Your Delta credit won't expire.",
    "You won't be charged the monthly fee this month.",
    "Venmo will waive the instant transfer fee.",
    "That charge is a duplicate and will be refunded.",
    "Your Experian subscription is a scam.",
    "The hold can't last more than 7 days.",
    "The bank has to make your deposit available the next day.",
    "Your bank can't hold a check for more than two days.",
    "Your landlord can't cash the check early.",
  ])("blocks %s", (text) => {
    expect(real(text).ok).toBe(false);
    expect(demo(text).ok).toBe(false);
  });

  it("blocks a settlement said not to be taxed on a real account", () => {
    expect(real("The settlement money isn't taxable.").ok).toBe(false);
  });
});

describe("what still passes on a real account", () => {
  it.each([
    "Your mobile check deposit of $400.00 posted Nov 1.",
    "Your paycheck of $400.00 arrived Nov 1, two days before payday.",
    "You have $400.00 safe to spend until your next payday, Nov 15 (in 3 days).",
    "Your Amazon refund of $90.00 posted Nov 1.",
    "Your savings rate is 4%, per your statement.",
    "Your Wells Fargo settlement deposit of $90.00 arrived Nov 1.",
    "Ask Amazon whether it adjusts prices after a drop.",
    "You could look up your state's unclaimed property site.",
    "Your hold of $90.00 at the hotel dropped off Nov 3.",
    "Your monthly fee of $5.00 posted Nov 1.",
    "Ask Experian what the subscription is for.",
    "Your breach alert from Experian is in your notes.",
  ])("passes %s", (text) => {
    expect(real(text)).toMatchObject({ ok: true });
  });
});
