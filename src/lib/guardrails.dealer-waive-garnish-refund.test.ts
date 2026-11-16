import { describe, expect, it } from "vitest";
import { checkGuardrails } from "./guardrails";

// Chat policy round 52 (11-16): what a dealer, gym or bank has to do, a right said to come from the
// law, rent control, what a collector can take, an old debt, a company's waiver predicted, a refund's
// timing, pay predicted and a raise said to be due, on any account; a tax-free gift on a real one.
const amounts = [500, 1549, 9000, 40000];
const real = (text: string) => checkGuardrails(text, amounts, undefined, "standard");
const demo = (text: string) => checkGuardrails(text, amounts, undefined, "demo_advice");

describe("duty, law, collection and prediction claims on any account", () => {
  it.each([
    "The dealer has to show you the invoice price.",
    "The gym has to let you cancel online.",
    "Your bank has to waive the overdraft fee.",
    "You have 30 days to return it by law.",
    "Rent control applies to your apartment.",
    "Your apartment is rent-stabilized.",
    "They can garnish your wages.",
    "Collectors can freeze your account.",
    "That debt is too old to collect.",
    "Chase will waive the fee if you call.",
    "Capital One will waive the late fee.",
    "They'll lower your APR if you ask.",
    "Your car will be repossessed if you miss one payment.",
    "Your refund will arrive in 21 days.",
    "Your paycheck will go up next year.",
    "You're due a raise.",
  ])("blocks %s", (text) => {
    expect(real(text).ok).toBe(false);
    expect(demo(text).ok).toBe(false);
  });

  it("blocks a tax-free gift on a real account", () => {
    expect(real("You won't owe anything on that gift.").ok).toBe(false);
  });
});

describe("what still passes on a real account", () => {
  it.each([
    "Your Chase overdraft fee of $5.00 was waived on Nov 1.",
    "Ask Chase whether they'd waive the fee.",
    "Ask the dealer to show you the invoice price.",
    "Ask your landlord if rent control applies.",
    "This will lower your bill by $15.49 a month.",
    "Switching to Mint will lower your bill to $15.49.",
    "Cancelling Hulu will cut your bills by $15.49.",
    "You will lower your interest by paying the card first.",
    "Jane will remove the finding once you mark it done.",
    "Your paycheck went up $90.00 on Nov 1.",
    "Your pay will go up $90.00 on Dec 1, per your raise letter.",
    "Your account will be closed on Dec 1 if you confirm.",
    "Your Law Offices of Kim charge was $400.00.",
    "Your Repo Coffee charge was $5.00.",
    "Your SNAP deposit of $400.00 arrived Nov 1.",
    "Under federal law your liability for unauthorized card charges is limited.",
    "They'll remove the charge once the refund posts.",
  ])("passes %s", (text) => {
    expect(real(text).ok).toBe(true);
  });
});
