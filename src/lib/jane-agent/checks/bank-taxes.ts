import type { CheckQuestion } from "./bank";

// Thirty tax questions people really ask (taxes in the chat), as must-pass checks: each is
// answered by the rules, with no key, in three sentences or fewer, from the demo person's own
// numbers (src/lib/tax-decisions.ts); the decisions carry the demo advice label. The
// follow-ups and the S corporation wait for Claude and the decision tool, and are marked.

const SHORT = 460;
const decide = (
  id: string,
  text: string,
  mentions: RegExp,
  extra: Partial<CheckQuestion["expect"]> = {},
): CheckQuestion => ({
  id,
  text,
  needs: "rules",
  expect: { intent: "decision", mentions, maxChars: SHORT, ...extra },
  sector: "taxes",
  page: "/taxes",
  tool: "tax_decide",
  profile: "demo_advice",
});
const fact = (
  id: string,
  text: string,
  mentions: RegExp,
  extra: Partial<CheckQuestion["expect"]> = {},
) => ({
  ...decide(id, text, mentions, { intent: "tax", ...extra }),
  profile: "standard" as const,
});
const later = (id: string, text: string, after?: string): CheckQuestion => ({
  id,
  text,
  needs: "claude",
  ...(after ? { after } : {}),
  expect: { mentions: /\$|%/ },
  sector: "taxes",
  page: "/taxes",
  tool: "tax_decide",
  profile: "demo_advice",
});

export const TAX_QUESTIONS: readonly CheckQuestion[] = [
  // Decisions.
  decide(
    "taxq-01",
    "should I itemize or take the standard deduction",
    /Itemize\.|standard deduction\./,
  ),
  decide("taxq-02", "should I do a Roth conversion this year", /bracket/),
  decide("taxq-03", "should I adjust my withholding", /W-4|withholding|paycheck/),
  decide("taxq-04", "do I need to pay estimated taxes", /^No\./, { intent: "tax" }),
  decide("taxq-05", "should I max out my 401k to lower my taxes", /401\(k\)/),
  decide("taxq-06", "should I contribute to a traditional IRA or a Roth IRA", /IRA/),
  decide("taxq-07", "should I open an HSA", /high-deductible/),
  decide("taxq-08", "is it worth appealing my property tax", /assessed/, { intent: "tax" }),
  decide("taxq-09", "should I sell my losing stocks for the tax loss", /below cost|loss/),
  decide("taxq-10", "should I donate stock instead of cash", /standard deduction|shares/),
  decide("taxq-11", "should I take the home office deduction", /employee|square/),
  // Facts, from the person's own numbers.
  fact("taxq-12", "how much will I owe in taxes this year", /refund of \$|owe \$/),
  fact("taxq-13", "how big will my refund be", /refund of \$/),
  fact("taxq-14", "why is my refund so big", /withheld/),
  fact("taxq-15", "what's my effective tax rate", /effective federal rate is about \d/),
  fact("taxq-16", "how much have I paid in federal tax", /withheld about \$/),
  fact("taxq-17", "what can I deduct", /standard \$/),
  fact("taxq-18", "how much should I set aside for taxes each paycheck", /employer/),
  fact("taxq-19", "when is my next estimated tax payment due", /April 15/),
  fact("taxq-20", "do I need to file a return", /^Yes\./),
  fact("taxq-21", "how much can I put in my 401k this year", /24,500/),
  fact("taxq-22", "how much of my mortgage interest can I deduct on my taxes", /mortgage interest/),
  // What was already answered well, kept as must-pass.
  fact("taxq-23", "what's my tax bracket", /22%/),
  fact("taxq-24", "when are my taxes due", /April 15/),
  fact("taxq-25", "what's the standard deduction", /16,100/, { intent: "learn" }),
  fact("taxq-26", "do I owe state taxes", /California/, { list: true, maxChars: 700 }),
  fact("taxq-27", "what tax forms am I waiting for", /W-2/, { list: true, maxChars: 700 }),
  // Waiting for the decision tool (follow-ups) and the S corporation step.
  later("taxq-28", "should I make an S corp"),
  later("taxq-29", "how much would that save me", "taxq-01"),
  later("taxq-30", "and what about next year", "taxq-02"),
];
