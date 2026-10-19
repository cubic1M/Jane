import { BENEFIT_LABELS, PAY_PERIODS } from "@/config/benefits";
import type { Benefit, BenefitAnswer, BenefitQuestion } from "@/lib/insurance/benefits";
import { formatCents } from "@/lib/money";
import type { ActionId, MessageAction } from "../types";

// Benefits through work in Jane's chat (spec step 150): what she found on the pay stub, and
// the short guided questions for cover no pay stub shows. Pure.

const PER = {
  weekly: "a week",
  biweekly: "every two weeks",
  semimonthly: "a paycheck",
  monthly: "a month",
} as const;

export const benefitLine = (b: Benefit) =>
  b.perPayCents > 0
    ? `${BENEFIT_LABELS[b.kind]}: ${formatCents(b.perPayCents)} ${PER[b.payFrequency]} (${formatCents(b.perPayCents * PAY_PERIODS[b.payFrequency])} a year)`
    : `${BENEFIT_LABELS[b.kind]}: paid by your employer`;

export function foundBody(found: Benefit[]): string {
  const employer = found[0]?.employer ?? "work";
  return [
    `I found ${found.length === 1 ? "a benefit" : `${found.length} benefits`} on your ${employer} pay stub.`,
    ...found.map((b) => `- ${benefitLine(b)}`),
    "Are these right? They only count on your insurance once you confirm them.",
  ].join("\n");
}

export const QUESTIONS: Record<BenefitQuestion, { body: string; actions: MessageAction[] }> = {
  life: {
    body: "One question about your job: does it give you life insurance at no cost to you? Many employers pay for one or two times your yearly pay.",
    actions: [
      { id: "benefits.life_1x", label: "Yes, 1× my pay", kind: "primary" },
      { id: "benefits.life_2x", label: "Yes, 2× my pay", kind: "secondary" },
      { id: "benefits.life_none", label: "No", kind: "secondary" },
      { id: "benefits.unsure", label: "Not sure", kind: "secondary" },
    ],
  },
  disability: {
    body: "And does your job give you long-term disability insurance? It usually replaces about 60 percent of your pay if you can't work for months.",
    actions: [
      { id: "benefits.disability_yes", label: "Yes", kind: "primary" },
      { id: "benefits.disability_none", label: "No", kind: "secondary" },
      { id: "benefits.unsure", label: "Not sure", kind: "secondary" },
    ],
  },
};

export const BENEFITS_LINK: MessageAction = {
  id: "open",
  label: "Your benefits",
  kind: "link",
  href: "/insurance/benefits",
};

// Each answer button's answer, for the page's forms.
export const ANSWER_OF: Partial<Record<ActionId | "open", BenefitAnswer>> = {
  "benefits.life_1x": "1x",
  "benefits.life_2x": "2x",
  "benefits.life_none": "none",
  "benefits.disability_yes": "yes",
  "benefits.disability_none": "none",
  "benefits.unsure": "unsure",
};
