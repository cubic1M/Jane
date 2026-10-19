import type { Intent } from "../intents";
import type { ActionId } from "../types";
import { charge, lastMonth, spentOn, thisMonth, type Facts } from "./facts";

// Jane's answer checks (spec step 87): about 100 things people really type, over the demo
// bank, each with what a good answer has. "rules" questions must be answered without
// Claude (they run in CI); "claude" ones are free questions, skipped without a key. A
// question with `after` is a follow-up, asked right after that one in the same
// conversation. A question moves from "claude" to "rules" once the rules answer it.

export type Expect = {
  // What the rules should read it as.
  intent?: Intent["kind"];
  // Amounts (in cents) the answer must give, from the person's numbers; null is skipped.
  figures?: (facts: Facts) => (number | null)[];
  // A button it should offer, or a link (the start of its address).
  button?: ActionId;
  link?: string;
  // Words it must have, or must not.
  mentions?: RegExp;
  avoid?: RegExp;
  // A short list is fine here: comparing options, or what's due.
  list?: boolean;
  maxChars?: number;
};

export type CheckQuestion = {
  id: string;
  text: string;
  needs: "rules" | "claude";
  after?: string;
  expect: Expect;
};

const safe = (f: Facts) => [f.safeCents];
const netflix = (f: Facts) => [charge(f, "Netflix")?.lastCents ?? null];
const food = (month: (f: Facts) => string) => (f: Facts) => [
  spentOn(f, "Food and drink", month(f)),
];
const ADVICE = /\b(?:stocks?|invest\w*|tax(?:es)?|lawyer|legal)\b/i;

export const QUESTIONS: readonly CheckQuestion[] = [
  // Safe to spend.
  {
    id: "safe-1",
    text: "safe to spend",
    needs: "rules",
    expect: { intent: "safe_to_spend", figures: safe },
  },
  {
    id: "safe-2",
    text: "how much can I spend",
    needs: "rules",
    expect: { intent: "safe_to_spend", figures: safe },
  },
  {
    id: "safe-3",
    text: "how much can I spend until payday",
    needs: "rules",
    expect: { intent: "safe_to_spend", figures: safe },
  },
  {
    id: "safe-4",
    text: "what can I still spend this month",
    needs: "rules",
    expect: { intent: "safe_to_spend", figures: safe },
  },
  {
    id: "safe-5",
    text: "how much do I have to spend",
    needs: "rules",
    expect: { intent: "safe_to_spend", figures: safe },
  },
  {
    id: "safe-6",
    text: "safe 2 spend",
    needs: "rules",
    expect: { intent: "safe_to_spend", figures: safe },
  },
  {
    id: "safe-7",
    text: "whats safe to spend?",
    needs: "rules",
    expect: { intent: "safe_to_spend", figures: safe },
  },
  {
    id: "safe-8",
    text: "how much money do i have left",
    needs: "rules",
    expect: { intent: "safe_to_spend", figures: safe },
  },
  {
    id: "safe-9",
    text: "safe to spnd",
    needs: "rules",
    expect: { intent: "safe_to_spend", figures: safe },
  },

  // Can I afford it?
  {
    id: "afford-1",
    text: "can I spend $500 this week for food",
    needs: "rules",
    expect: { intent: "afford", figures: () => [50_000], mentions: /food/i },
  },
  {
    id: "afford-2",
    text: "can I afford $900 for a trip in March",
    needs: "rules",
    expect: { intent: "afford", figures: () => [90_000], button: "goal.start" },
  },
  {
    id: "afford-3",
    text: "can I buy a $1,200 laptop",
    needs: "rules",
    expect: { intent: "afford", figures: () => [120_000] },
  },
  {
    id: "afford-4",
    text: "should I spend 300 on clothes this month",
    needs: "rules",
    expect: { intent: "afford", figures: () => [30_000] },
  },
  {
    id: "afford-5",
    text: "can i afford a $40 dinner tonight",
    needs: "rules",
    expect: { intent: "afford", figures: () => [4_000] },
  },
  {
    id: "afford-6",
    text: "is it ok to spend $200 on groceries this week",
    needs: "rules",
    expect: { intent: "afford", figures: () => [20_000], mentions: /groceries|food/i },
  },
  {
    id: "afford-7",
    text: "can I spend $500 a month on food",
    needs: "rules",
    expect: { intent: "afford", figures: () => [50_000], mentions: /food/i },
  },
  {
    id: "afford-8",
    text: "can I afford 2k for a vacation in june",
    needs: "rules",
    expect: { intent: "afford", figures: () => [200_000], button: "goal.start" },
  },
  {
    id: "afford-9",
    text: "do I have enough for a $150 concert ticket",
    needs: "rules",
    expect: { intent: "afford", figures: () => [15_000] },
  },
  {
    id: "afford-10",
    text: "can I afford it",
    needs: "rules",
    expect: { intent: "afford", mentions: /how much/i },
  },
  {
    id: "afford-11",
    text: "can i aford $300 for shoes",
    needs: "rules",
    expect: { intent: "afford", figures: () => [30_000] },
  },

  // What I spent.
  {
    id: "spent-1",
    text: "how much did I spend on food last month",
    needs: "rules",
    expect: { intent: "spending", figures: food(lastMonth), link: "/insights" },
  },
  {
    id: "spent-2",
    text: "how much did I spend this month",
    needs: "rules",
    expect: { intent: "spending", figures: (f) => [f.months[thisMonth(f)]?.totalCents ?? null] },
  },
  {
    id: "spent-3",
    text: "what did I spend on gas last month",
    needs: "rules",
    expect: { intent: "spending" },
  },
  {
    id: "spent-4",
    text: "how much have I spent at Target",
    needs: "rules",
    expect: { intent: "spending", mentions: /target/i },
  },
  {
    id: "spent-5",
    text: "how much did I spend on Uber in September",
    needs: "rules",
    expect: { intent: "spending", mentions: /uber/i },
  },
  {
    id: "spent-6",
    text: "how much do I spend on coffee",
    needs: "rules",
    expect: { intent: "spending" },
  },
  {
    id: "spent-7",
    text: "what's my biggest spending this month",
    needs: "rules",
    expect: { intent: "spending", list: true },
  },
  { id: "spent-8", text: "where does my money go", needs: "rules", expect: { list: true } },
  {
    id: "spent-9",
    text: "how much did i spend on restaurants last month",
    needs: "rules",
    expect: { intent: "spending", figures: food(lastMonth) },
  },
  {
    id: "spent-10",
    text: "spending last month",
    needs: "rules",
    expect: { intent: "spending", figures: (f) => [f.months[lastMonth(f)]?.totalCents ?? null] },
  },
  {
    id: "spent-11",
    text: "hw much did i spend on fod last month",
    needs: "rules",
    expect: { intent: "spending", figures: food(lastMonth) },
  },

  // What one thing costs.
  {
    id: "cost-1",
    text: "how much is Netflix",
    needs: "rules",
    expect: { figures: netflix, mentions: /netflix/i },
  },
  {
    id: "cost-2",
    text: "how much do I pay for Spotify",
    needs: "rules",
    expect: { figures: (f) => [charge(f, "Spotify")?.lastCents ?? null] },
  },
  {
    id: "cost-3",
    text: "what does Hulu cost me",
    needs: "rules",
    expect: { figures: (f) => [charge(f, "Hulu")?.lastCents ?? null] },
  },
  {
    id: "cost-4",
    text: "how much is my phone bill",
    needs: "rules",
    expect: { figures: (f) => [charge(f, "Verizon Wireless")?.lastCents ?? null] },
  },
  { id: "cost-5", text: "netflix?", needs: "rules", expect: { figures: netflix } },
  {
    id: "cost-6",
    text: "how much do I pay for Comcast a year",
    needs: "rules",
    expect: { figures: (f) => [charge(f, "Comcast")?.yearCents ?? null] },
  },
  {
    id: "cost-7",
    text: "how much is my gym",
    needs: "rules",
    expect: { figures: (f) => [charge(f, "Planet Fitness")?.lastCents ?? null] },
  },

  // Subscriptions.
  {
    id: "subs-1",
    text: "what subscriptions do I have",
    needs: "rules",
    expect: { list: true, mentions: /netflix/i, link: "/subscriptions" },
  },
  {
    id: "subs-2",
    text: "list my subscriptions",
    needs: "rules",
    expect: { list: true, mentions: /netflix/i },
  },
  { id: "subs-3", text: "subs", needs: "rules", expect: { list: true, mentions: /netflix/i } },
  {
    id: "subs-4",
    text: "how much do I spend on subscriptions",
    needs: "rules",
    expect: { mentions: /a (?:month|year)/i },
  },
  {
    id: "subs-5",
    text: "what am I paying for every month",
    needs: "rules",
    expect: { list: true },
  },

  // Paydays.
  { id: "pay-1", text: "when do I get paid", needs: "rules", expect: {} },
  { id: "pay-2", text: "when's my next paycheck", needs: "rules", expect: {} },
  { id: "pay-3", text: "next payday", needs: "rules", expect: {} },

  // What's due.
  {
    id: "due-1",
    text: "what's due this week",
    needs: "rules",
    expect: { intent: "coming_up", list: true, link: "/bills" },
  },
  {
    id: "due-2",
    text: "what bills are coming up",
    needs: "rules",
    expect: { intent: "coming_up", list: true },
  },
  { id: "due-3", text: "whats due", needs: "rules", expect: { intent: "coming_up", list: true } },
  {
    id: "due-4",
    text: "upcoming bills",
    needs: "rules",
    expect: { intent: "coming_up", list: true },
  },
  {
    id: "due-5",
    text: "what do I owe this month",
    needs: "rules",
    expect: { intent: "coming_up", list: true },
  },
  {
    id: "due-6",
    text: "whats due this wk",
    needs: "rules",
    expect: { intent: "coming_up", list: true },
  },

  // Acting on what Jane found.
  {
    id: "act-1",
    text: "cancel Hulu",
    needs: "rules",
    expect: { intent: "act", button: "finding.yes", mentions: /hulu/i },
  },
  {
    id: "act-2",
    text: "lower my phone bill",
    needs: "rules",
    expect: { intent: "act", button: "finding.yes", mentions: /verizon/i },
  },
  {
    id: "act-3",
    text: "get my refund from Target",
    needs: "rules",
    expect: { intent: "act", button: "finding.yes", mentions: /target/i },
  },
  {
    id: "act-4",
    text: "cancel Netflix",
    needs: "rules",
    expect: { intent: "act", button: "finding.yes", mentions: /netflix/i },
  },
  {
    id: "act-5",
    text: "lower my internet bill",
    needs: "rules",
    expect: { intent: "act", button: "finding.yes", mentions: /comcast/i },
  },
  {
    id: "act-6",
    text: "cancle hulu",
    needs: "rules",
    expect: { button: "finding.yes", mentions: /hulu/i },
  },
  {
    id: "act-7",
    text: "cancel my gym",
    needs: "rules",
    expect: { button: "finding.yes", mentions: /planet fitness/i },
  },
  {
    id: "act-8",
    text: "stop paying for Peacock",
    needs: "rules",
    expect: { button: "finding.yes", mentions: /peacock/i },
  },
  {
    id: "act-9",
    text: "tell me about the MasterClass charge",
    needs: "rules",
    expect: { button: "finding.yes", mentions: /masterclass/i },
  },
  // Two fee findings: it could mean either, so Jane asks which, a button each.
  {
    id: "act-10",
    text: "the bank fees",
    needs: "rules",
    expect: { button: "clarify.1", mentions: /fees/i },
  },

  // Commands.
  { id: "cmd-1", text: "help", needs: "rules", expect: { intent: "help", list: true } },
  { id: "cmd-2", text: "hi", needs: "rules", expect: { intent: "greeting", figures: safe } },
  { id: "cmd-3", text: "thanks", needs: "rules", expect: { intent: "greeting" } },
  { id: "cmd-4", text: "what did you do", needs: "rules", expect: { intent: "what_did" } },
  {
    id: "cmd-5",
    text: "yes to all",
    needs: "rules",
    expect: { intent: "approve_all", button: "plan.approve_safe" },
  },
  { id: "cmd-6", text: "undo", needs: "rules", expect: { intent: "undo" } },
  { id: "cmd-7", text: "pause autopilot", needs: "rules", expect: { intent: "pause_autopilot" } },
  { id: "cmd-8", text: "what's new", needs: "rules", expect: { intent: "what_did" } },
  {
    id: "cmd-9",
    text: "approve the safe ones",
    needs: "rules",
    expect: { intent: "approve_all", button: "plan.approve_safe" },
  },
  { id: "cmd-10", text: "stop autopilot", needs: "rules", expect: { intent: "pause_autopilot" } },

  // Telling Jane something (spec step 91): offered to remember, saved only on the tap.
  {
    id: "tell-1",
    text: "payday is the 15th",
    needs: "rules",
    expect: { intent: "remember", button: "pref.save", mentions: /15th/ },
  },
  {
    id: "tell-2",
    text: "I need my car",
    needs: "rules",
    expect: { intent: "remember", button: "pref.save", mentions: /car/ },
  },

  // Follow-ups: the second needs the first.
  {
    id: "follow-1",
    text: "how much did I spend on food last month",
    needs: "rules",
    expect: { intent: "spending", figures: food(lastMonth) },
  },
  {
    id: "follow-1b",
    text: "what about this month?",
    needs: "rules",
    after: "follow-1",
    expect: { figures: food(thisMonth) },
  },
  {
    id: "follow-2",
    text: "cancel Hulu",
    needs: "rules",
    expect: { button: "finding.yes", mentions: /hulu/i },
  },
  {
    id: "follow-2b",
    text: "and Peacock?",
    needs: "rules",
    after: "follow-2",
    expect: { button: "finding.yes", mentions: /peacock/i },
  },
  { id: "follow-3", text: "how much is Netflix", needs: "rules", expect: { figures: netflix } },
  {
    id: "follow-3b",
    text: "cancel it",
    needs: "rules",
    after: "follow-3",
    expect: { button: "finding.yes", mentions: /netflix/i },
  },
  {
    id: "follow-4",
    text: "how much did I spend at Target in September",
    needs: "rules",
    expect: { mentions: /target/i },
  },
  {
    id: "follow-4b",
    text: "and in August?",
    needs: "rules",
    after: "follow-4",
    expect: { mentions: /target/i },
  },
  {
    id: "follow-5",
    text: "should I cancel Netflix",
    needs: "claude",
    expect: { button: "finding.yes", mentions: /netflix/i },
  },
  {
    id: "follow-5b",
    text: "and Hulu?",
    needs: "claude",
    after: "follow-5",
    expect: { button: "finding.yes", mentions: /hulu/i },
  },
  { id: "follow-6", text: "what subscriptions do I have", needs: "rules", expect: { list: true } },
  {
    id: "follow-6b",
    text: "which one should I cancel first?",
    needs: "claude",
    after: "follow-6",
    expect: { button: "finding.yes" },
  },
  {
    id: "follow-7",
    text: "what should I cancel",
    needs: "claude",
    expect: { button: "finding.yes" },
  },
  {
    id: "follow-7b",
    text: "you tell me",
    needs: "claude",
    after: "follow-7",
    expect: { button: "finding.yes" },
  },

  // Free questions.
  {
    id: "free-1",
    text: "why is my phone bill so high",
    needs: "claude",
    expect: { mentions: /verizon/i, button: "finding.yes" },
  },
  { id: "free-2", text: "am I on track this month", needs: "claude", expect: {} },
  {
    id: "free-3",
    text: "where can I save money",
    needs: "claude",
    expect: { button: "finding.yes" },
  },
  {
    id: "free-4",
    text: "what should I do first",
    needs: "claude",
    expect: { button: "finding.yes" },
  },
  {
    id: "free-5",
    text: "am I spending too much on food",
    needs: "claude",
    expect: { mentions: /food/i },
  },
  {
    id: "free-6",
    text: "is my Comcast bill normal",
    needs: "claude",
    expect: { mentions: /comcast/i, button: "finding.yes" },
  },
  { id: "free-7", text: "how are my goals doing", needs: "claude", expect: {} },
  { id: "free-8", text: "how's my budget", needs: "claude", expect: {} },
  { id: "free-9", text: "what's my net worth", needs: "claude", expect: {} },
  { id: "free-10", text: "why did you flag Hulu", needs: "claude", expect: { mentions: /hulu/i } },
  {
    id: "free-11",
    text: "what's the best thing to cut",
    needs: "claude",
    expect: { button: "finding.yes" },
  },
  { id: "free-12", text: "help me save $200 a month", needs: "claude", expect: { list: true } },
  {
    id: "free-13",
    text: "should I keep Peacock and Paramount+",
    needs: "claude",
    expect: { list: true },
  },
  { id: "free-14", text: "explain my plan for this week", needs: "claude", expect: { list: true } },
  { id: "free-15", text: "what's that late fee", needs: "claude", expect: { mentions: /fee/i } },
  {
    id: "free-16",
    text: "is the overdraft fee refundable",
    needs: "claude",
    expect: { mentions: /fee/i },
  },

  // Taxes (spec steps 118–127): answered by rules, in demo advice mode on the demo bank.
  {
    id: "tax-1",
    text: "what's my tax profile",
    needs: "rules",
    expect: { intent: "tax", list: true, link: "/taxes/profile" },
  },
  {
    id: "tax-2",
    text: "how much will I owe in taxes",
    needs: "rules",
    expect: { intent: "tax", mentions: /\bestimate\b/i, link: "/taxes" },
  },
  {
    id: "tax-3",
    text: "will I get a tax refund",
    needs: "rules",
    expect: { intent: "tax", mentions: /\brefund of about \$[\d,]+/i },
  },
  {
    id: "tax-4",
    text: "what's my tax bracket",
    needs: "rules",
    expect: { intent: "tax", mentions: /\b\d+%/ },
  },
  {
    id: "tax-5",
    text: "am I withholding too much",
    needs: "rules",
    expect: { intent: "tax", button: "tax.w4_start", mentions: /W-4/ },
  },
  {
    id: "tax-6",
    text: "how can I pay less tax",
    needs: "rules",
    expect: { intent: "tax", button: "tax.save_task", mentions: /401\(k\)/ },
  },
  {
    id: "tax-7",
    text: "how much have I donated this year",
    needs: "rules",
    expect: { intent: "tax", mentions: /American Red Cross/ },
  },
  {
    id: "tax-8",
    text: "what tax forms should I expect",
    needs: "rules",
    expect: { intent: "tax", list: true, mentions: /W-2/ },
  },
  {
    id: "tax-9",
    text: "my tax pack",
    needs: "rules",
    expect: { intent: "tax", link: "/tax-pack" },
  },
  {
    id: "tax-10",
    text: "where's my refund",
    needs: "rules",
    expect: { intent: "tax", mentions: /\brefund\b/i },
  },
  {
    id: "tax-11",
    text: "when are my quarterly taxes due",
    needs: "rules",
    expect: { intent: "tax", mentions: /freelance/i },
  },
  {
    id: "tax-12",
    text: "how do I file my taxes",
    needs: "rules",
    expect: { intent: "tax", mentions: /April 15/ },
  },
  {
    id: "tax-13",
    text: "I'm married filing jointly",
    needs: "rules",
    expect: { intent: "tax", button: "tax.filing_joint" },
  },
  {
    id: "tax-14",
    text: "tag Starbucks as work",
    needs: "rules",
    expect: { intent: "tax", button: "tax.tag_set" },
  },
  {
    id: "tax-15",
    text: "what's the standard deduction",
    needs: "rules",
    expect: { intent: "tax", mentions: /\$16,100/ },
  // Insurance (spec step 108), over the demo bank's sample GEICO car policy
  // (DEMO_POLICY in src/lib/insurance/profile.ts: $142.00 a month, a $1,000.00 deductible).
  {
    id: "ins-1",
    text: "what insurance do I have",
    needs: "rules",
    expect: { intent: "insurance", figures: () => [14_200], mentions: /GEICO/, list: true },
  },
  {
    id: "ins-2",
    text: "what does my car insurance cover",
    needs: "rules",
    expect: { intent: "insurance", figures: () => [100_000], mentions: /collision/i, list: true },
  },
  {
    id: "ins-3",
    text: "when does my car insurance renew",
    needs: "rules",
    expect: { intent: "insurance", mentions: /renews on/ },
  },
  {
    id: "ins-4",
    text: "how much is my car insurance",
    needs: "rules",
    expect: { intent: "insurance", figures: () => [14_200, 170_400] },
  },
  {
    id: "ins-5",
    text: "what's my deductible",
    needs: "rules",
    expect: { intent: "insurance", figures: () => [100_000] },
  },
  {
    id: "ins-6",
    text: "am I missing any insurance",
    needs: "rules",
    expect: { intent: "insurance", mentions: /home insurance/i, list: true },
  },
  {
    id: "ins-7",
    text: "find me cheaper car insurance",
    needs: "rules",
    expect: {
      intent: "insurance",
      button: "insurance.shop_yes",
      mentions: /same cover/,
      list: true,
    },
  },
  {
    id: "ins-8",
    text: "check my insurance",
    needs: "rules",
    expect: { intent: "insurance", mentions: /deductible/i, list: true },
  },
  {
    id: "ins-9",
    text: "I had a car accident",
    needs: "rules",
    expect: {
      intent: "insurance",
      button: "insurance.claim_start",
      mentions: /911/,
      list: true,
      // The guide: what to do now and what to collect, in one message.
      maxChars: 1_100,
    },
  },
  {
    id: "ins-10",
    text: "how's my insurance switch going",
    needs: "rules",
    expect: { intent: "insurance", mentions: /not switching/ },
  },
  {
    id: "ins-11",
    text: "what do you do with my insurance on your own",
    needs: "rules",
    expect: { intent: "insurance", mentions: /never buy, change or cancel/ },
  },
  {
    id: "ins-12",
    text: "how do I contact my insurer",
    needs: "rules",
    expect: { intent: "insurance", mentions: /GEICO/, list: true },
  },
  {
    id: "ins-13",
    text: "does my car insurance include collision",
    needs: "rules",
    expect: { intent: "insurance", mentions: /Collision/, list: true },
  },
  {
    id: "ins-14",
    text: "should I raise my deductible",
    needs: "rules",
    expect: { intent: "insurance", mentions: /deductible/i, list: true },
  },

  // Insurance questions only Claude answers.
  {
    id: "ins-free-1",
    text: "is my car insurance a good deal",
    needs: "claude",
    expect: { mentions: /GEICO/ },
  },
  {
    id: "ins-free-2",
    text: "what would raising my deductible save",
    needs: "claude",
    expect: { mentions: /deductible/i },
  },

  // Outside what Jane does: brief, and never advice.
  { id: "out-1", text: "what's the weather today", needs: "claude", expect: { avoid: ADVICE } },
  {
    id: "out-2",
    text: "should I buy Tesla stock",
    needs: "claude",
    expect: { avoid: /\bbuy\b.*\bstock|\byou should (?:buy|sell)\b/i },
  },
  { id: "out-4", text: "tell me a joke", needs: "claude", expect: { avoid: ADVICE } },
];
