import { describe, expect, it } from "vitest";
import { checkGuardrails } from "./guardrails";

// Chat policy round 61 (11-18): a company's refund promised for any purchase, what a platform or a
// school has to pay or return, what the person may do by law, what a purchase legally needs, a
// payment said to be final, a balance said to roll over or never expire, no fees promised, a shop
// called protected, a subscription said to cancel itself, on any account. Sales tax said not to
// apply, money said not to be income and a reporting limit are tax advice, so real accounts only.
const amounts = [500, 1549, 9000, 40000];
const real = (text: string) => checkGuardrails(text, amounts, undefined, "standard");
const demo = (text: string) => checkGuardrails(text, amounts, undefined, "demo_advice");

describe("refund, platform, lease, rollover and payment-final claims on any account", () => {
  it.each([
    "Apple will refund the app if you ask within 90 days.",
    "Xbox will refund the game since you didn't play it.",
    "Your kid's in-app purchases can be refunded.",
    "Your meal plan balance will be refunded at the end of the term.",
    "Upwork has to pay you within five days.",
    "The university must return your housing deposit.",
    "The housing office can't charge you for the damage.",
    "Your client can't take back the payment.",
    "You can charge interest on late invoices.",
    "You don't need a business license for this.",
    "You can end the lease early with no fee.",
    "The extended warranty is required for the loan.",
    "Dealer add-ons are optional by law.",
    "Buyers can't reverse a Zelle payment.",
    "The marketplace buyer has no way to get the money back.",
    "Unused meal swipes roll over to next quarter.",
    "Your Steam wallet money never expires.",
    "Your lease turn-in won't have any fees.",
    "Your Etsy shop is protected from chargebacks.",
    "PayPal will cover you if the buyer files a claim.",
    "The app subscription will cancel itself when the trial ends.",
  ])("blocks %s", (text) => {
    expect(real(text).ok).toBe(false);
    expect(demo(text).ok).toBe(false);
  });

  it.each([
    "You don't need to collect sales tax on Etsy.",
    "Selling your old textbooks isn't income.",
    "Your work-study pay isn't counted as income for aid.",
    "Your Fiverr earnings are under the reporting limit, so you're fine.",
  ])("blocks %s on a real account", (text) => {
    expect(real(text).ok).toBe(false);
  });
});

describe("what still passes on a real account", () => {
  it.each([
    "Your App Store charge of $15.49 posted Nov 1.",
    "Ask Apple whether the purchase can be refunded.",
    "Your Upwork payout of $400.00 arrived Nov 1.",
    "Your invoice to Acme for $400.00 is still unpaid, per your note.",
    "Your car lease payment of $400.00 posted Nov 1.",
    "You could ask the dealer which add-ons are optional.",
    "Your meal plan charge of $400.00 posted Aug 15.",
    "Your Etsy fees of $5.00 posted Nov 1.",
    "Your Fiverr payout of $90.00 arrived Nov 1.",
    "IRS: a gift isn't income to the person who receives it",
    "May not send one: below the reporting threshold. Your own records count.",
    "If you only bought once, the second charge can usually be refunded, by the merchant or through your card company.",
  ])("passes %s", (text) => {
    expect(real(text)).toMatchObject({ ok: true });
  });
});
