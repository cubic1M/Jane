import { describe, expect, it } from "vitest";
import { checkGuardrails } from "./guardrails";

// Chat policy round 62 (11-18), Stanford money (the beta's first audience): a named plan, school
// or office said to cover, refund or not to charge, a named bank with no fees, aid said not to
// change or to cover a cost, a named grant said to be theirs, things called free, tuition
// predicted, and a refund, credit or buy-back promised, on any account. Stanford facts are
// checked at the source, not said from memory (founder 11-16).
const amounts = [500, 1549, 9000, 40000];
const real = (text: string) => checkGuardrails(text, amounts, undefined, "standard");
const demo = (text: string) => checkGuardrails(text, amounts, undefined, "demo_advice");

describe("Stanford money claims on any account", () => {
  it.each([
    "Cardinal Care covers dental cleanings.",
    "Cardinal Care will pay for your therapy at Vaden.",
    "Stanford Health Care bills are covered by Cardinal Care in full.",
    "You can waive Cardinal Care and get the fee back.",
    "Stanford will refund your housing if you move out early.",
    "The Bursar won't charge a late fee if you pay by Friday.",
    "Stanford can't drop your classes for an unpaid bill.",
    "Your TA pay won't reduce your financial aid.",
    "Your outside scholarship won't change your Stanford aid.",
    "Your work-study earnings don't count against your aid.",
    "Stanford's aid will cover your summer quarter.",
    "Your financial aid will increase next year.",
    "Stanford's need-based aid means you'll graduate debt-free.",
    "You qualify for the Stanford emergency grant.",
    "Stanford FCU has no overdraft fees.",
    "Your Go Pass is free all year.",
    "Vaden visits are always free.",
    "Your Stanford ID card covers laundry for free.",
    "Your RA stipend covers your whole housing bill.",
    "The university pays your tuition if you're a TA.",
    "Your tuition will go down if you drop to part time.",
    "Your Clipper card balance never expires.",
    "The bookstore will buy back your books for half price.",
    "Stanford Dining will credit back unused meals.",
    "Your grad housing deposit is refundable.",
  ])("blocks %s", (text) => {
    expect(real(text).ok).toBe(false);
    expect(demo(text).ok).toBe(false);
  });
});

describe("what still passes on a real account", () => {
  it.each([
    "Your Stanford Bursar payment of $400.00 posted Nov 1.",
    "Your Cardinal Care charge of $400.00 is on your Stanford bill.",
    "Your Stanford stipend of $400.00 arrived Nov 1.",
    "Your Stanford FCU checking balance is $400.00.",
    "Your Clipper card reload of $15.49 posted Nov 1.",
    "Ask the Financial Aid Office how a summer quarter changes your aid.",
    "Your Stanford late fee of $5.00 is on your bill, per the Bursar's notice.",
    "You could check Stanford's financial aid site for the deadline.",
    "Your bank won't charge a fee if you keep $400.00 in checking, per its terms.",
    "Who covers you is below.",
    "Plaid can't read that account in the beta.",
  ])("passes %s", (text) => {
    expect(real(text)).toMatchObject({ ok: true });
  });
});
