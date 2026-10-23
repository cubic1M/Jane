import type { CheckQuestion } from "./bank";

// Spec step 297 (Phase AW, Stage A): the graded questions about the practice portfolio. The
// check person has one, run day by day through the week before the checks (./person.ts), so
// "what did you buy this week" has trades to name. Rules answers, so they run in CI. Practice
// money only: no answer may say a real trade was made.

const PAGE = "/investments/practice";
const PRACTICE = { sector: "investing", page: PAGE, profile: "demo_advice" } as const;
// Words that would mean real money moved.
const REAL = /\breal (?:money|account|order|trade)s? (?:moved|was|were|placed|made)\b/i;

export const PRACTICE_QUESTIONS: readonly CheckQuestion[] = [
  {
    id: "prac-1",
    text: "what did you buy this week and why",
    needs: "rules",
    expect: { intent: "investments", mentions: /practice/i, link: PAGE, list: true, avoid: REAL },
    ...PRACTICE,
  },
  {
    id: "prac-2",
    text: "pause it",
    needs: "rules",
    after: "prac-1",
    expect: { intent: "investments", mentions: /\bpaused\b/i, link: PAGE, avoid: REAL },
    ...PRACTICE,
  },
  {
    id: "prac-3",
    text: "resume it",
    needs: "rules",
    // Follow-ups hang off the lead question, asked in order: pause, then resume.
    after: "prac-1",
    expect: { intent: "investments", mentions: /\bresumed\b/i, link: PAGE },
    ...PRACTICE,
  },
  {
    id: "prac-4",
    text: "what's my risk level",
    needs: "rules",
    expect: { intent: "investments", mentions: /\bmedium\b/i, link: "/investments/profile" },
    ...PRACTICE,
  },
  {
    id: "prac-5",
    text: "how would a High portfolio have done in 2022",
    needs: "rules",
    expect: {
      intent: "investments",
      mentions: /\bHigh portfolio in 2022\b[\s\S]*not a forecast/i,
      link: "/investments",
      avoid: /\bwill (?:grow|rise|return|make)\b/i,
    },
    ...PRACTICE,
  },
  {
    id: "prac-9",
    text: "did the extra rules help?",
    needs: "rules",
    expect: {
      intent: "investments",
      mentions: /\bYour level, Medium\b[\s\S]*Plain rebalancing[\s\S]*not a forecast/i,
      link: "/investments",
      avoid: /\bwill (?:grow|rise|return|make)\b/i,
    },
    ...PRACTICE,
  },
  {
    id: "prac-6",
    text: "show my practice trades",
    needs: "rules",
    expect: { intent: "investments", mentions: /practice/i, link: PAGE, list: true, avoid: REAL },
    ...PRACTICE,
  },
  {
    id: "prac-7",
    text: "pause opportunities",
    needs: "rules",
    expect: { intent: "investments", mentions: /\bopportunities\b/i, link: PAGE },
    ...PRACTICE,
  },
  {
    id: "prac-8",
    text: "resume opportunities",
    needs: "rules",
    after: "prac-7",
    expect: { intent: "investments", mentions: /\bresumed\b/i, link: PAGE },
    ...PRACTICE,
  },
];
