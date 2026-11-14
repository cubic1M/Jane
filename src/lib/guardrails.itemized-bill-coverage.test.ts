import { describe, expect, it } from "vitest";
import { MEDICAL_RULES } from "@/config/medical-bills";
import { checkGuardrails } from "./guardrails";

// Chat policy round 36 (11-14): an itemized bill is what the medical bills page asks a hospital for,
// and was blocked on real accounts as itemized deductions. Also: what's deductible, health and labor
// laws, entitlements, "you can't be billed", stopping payment on a timeshare, small claims, and
// promises that insurance will cover it, a claim will be paid or a bill lowered.
const amounts = [9000, 1549, 3500, 10000, 40000];
const real = (text: string) => checkGuardrails(text, amounts, undefined, "standard");
const demo = (text: string) => checkGuardrails(text, amounts, undefined, "demo_advice");

describe("an itemized bill on a real account", () => {
  it.each([
    "Ask the hospital for an itemized bill.",
    "Ask for an itemized bill, and for financial help or a no-interest plan, on your medical bills",
    "Ask the vet for an itemized invoice.",
    "The itemized bill from the doctor or hospital",
    "After the $100 and 10%-of-income floors none of it is deductible.",
  ])("lets %s through", (text) => {
    expect(real(text).ok).toBe(true);
  });

  it("lets the medical bills page's own itemized-bill line through", () => {
    expect(real(MEDICAL_RULES.itemized).ok).toBe(true);
  });

  it.each([
    "Itemize your deductions this year.",
    "You should itemize.",
    "Itemizing saves you more.",
    "Medical bills over 7.5% of your income are deductible.",
  ])("still stops %s", (text) => {
    expect(real(text).ok).toBe(false);
  });
});

describe("legal calls on any account", () => {
  it.each([
    "The No Surprises Act protects you here.",
    "Under the FMLA you get 12 weeks.",
    "You can't be billed for that.",
    "You're entitled to a refund.",
    "You can stop paying your timeshare.",
    "Small claims is your best bet.",
    "Take them to small claims.",
  ])("stops %s", (text) => {
    expect(real(text).ok).toBe(false);
    expect(demo(text).ok).toBe(false);
  });

  it.each(["You can stop paying for Hulu today.", "Your Medicare premium of $90.00 posted Nov 1."])(
    "lets %s through",
    (text) => {
      expect(real(text).ok).toBe(true);
      expect(demo(text).ok).toBe(true);
    },
  );
});

describe("promises on any account", () => {
  it.each([
    "Insurance will cover it.",
    "Medicaid will cover the surgery.",
    "Your claim will be paid.",
    "The hospital will lower the bill.",
    "Your premium won't go up.",
    "The CFPB will make them refund you.",
  ])("stops %s", (text) => {
    expect(real(text).ok).toBe(false);
    expect(demo(text).ok).toBe(false);
  });

  it.each([
    "Your plan will cover rent through Dec 1.",
    "They waived the $35.00 fee on Nov 3.",
    "Your Geico refund of $90.00 landed Nov 3.",
  ])("lets %s through", (text) => {
    expect(real(text).ok).toBe(true);
    expect(demo(text).ok).toBe(true);
  });
});
