import { SECTOR_DECISIONS } from "@/config/decisions";
import type { Intent } from "../intents";
import type { ActionId } from "../types";
import { charge, lastMonth, spentOn, thisMonth, type Facts } from "./facts";
import { MORE_ROWS } from "./bank-more";
import { TAX_QUESTIONS } from "./bank-taxes";

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
  // A straight answer to a decision: this many sentences at most.
  maxSentences?: number;
  // An informational question gets no action button (a link to a page is fine): a button
  // only appears when the person asked Jane to do something.
  noButtons?: boolean;
};

export type CheckQuestion = {
  id: string;
  text: string;
  needs: "rules" | "claude";
  after?: string;
  expect: Expect;
  // Spec step 189: where it belongs (a sector and the page it's about), the Claude tool it
  // should reach, and the guardrail profile its answer is checked with. Questions from
  // bank-more.ts carry all four.
  sector?: string;
  page?: string;
  tool?: string;
  profile?: "standard" | "demo_advice";
  // The sample person it is asked as (src/config/people.ts), and the rules the judge holds
  // the answer to (scenario files; see scenarios.ts).
  person?: string;
  judge?: { mustDo?: string[]; mustNot?: string[] };
};

const safe = (f: Facts) => [f.safeCents];
// Spec step 183: answers that are a short list by design.
const WHOLE: Expect = { intent: "whole_picture", figures: safe, list: true, maxChars: 900 };
const WHOLE_MONTH: Expect = { intent: "whole_picture", list: true, maxChars: 900 };
const PAYROLL: Expect = { mentions: /acme/i, avoid: /interest|\$1\.02/i };
const netflix = (f: Facts) => [charge(f, "Netflix")?.lastCents ?? null];
const food = (month: (f: Facts) => string) => (f: Facts) => [
  spentOn(f, "Food and drink", month(f)),
];
// Spec step 137: the investment figures a right answer gives.
const invested = (f: Facts) => [f.investments?.totalCents ?? null];
const inAccount = (name: string) => (f: Facts) => [
  f.investments?.accounts.find((a) => a.name.includes(name))?.balanceCents ?? null,
];
const ADVICE = /\b(?:stocks?|invest\w*|tax(?:es)?|lawyer|legal)\b/i;

const BASE_QUESTIONS: readonly CheckQuestion[] = [
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

  // Paydays: the demo bank's payroll on the 1st and 15th, never its $1.02 of interest
  // (spec step 182).
  { id: "pay-1", text: "when do I get paid", needs: "rules", expect: PAYROLL },
  { id: "pay-2", text: "when's my next paycheck", needs: "rules", expect: PAYROLL },
  { id: "pay-3", text: "next payday", needs: "rules", expect: PAYROLL },

  // The whole picture, across every sector (spec step 183): the verdict first with safe to
  // spend, then the one to three things that matter.
  { id: "whole-1", text: "am I ok?", needs: "rules", expect: WHOLE },
  { id: "whole-2", text: "how am I doing", needs: "rules", expect: WHOLE },
  { id: "whole-3", text: "how are my finances looking", needs: "rules", expect: WHOLE },
  { id: "whole-4", text: "give me the big picture", needs: "rules", expect: WHOLE },
  { id: "whole-5", text: "what should I do this month", needs: "rules", expect: WHOLE_MONTH },
  { id: "whole-6", text: "whats my plan for this month", needs: "rules", expect: WHOLE_MONTH },
  {
    id: "whole-7",
    text: "honestly, is my money situation alright or should I be worried?",
    needs: "claude",
    expect: { figures: safe },
  },
  {
    id: "whole-8",
    text: "how am I doing",
    needs: "rules",
    expect: { mentions: /\bpayday\b/i, list: true, maxChars: 900 },
  },
  {
    id: "whole-8b",
    text: "ok what's the first one?",
    needs: "claude",
    after: "whole-8",
    expect: {},
  },

  // Requests that span sectors (spec step 185): one plan, one confirmation.
  {
    id: "multi-1",
    text: "cancel Hulu and Netflix",
    needs: "rules",
    expect: { intent: "multi", button: "multi.confirm", list: true },
  },
  {
    id: "multi-2",
    text: "cancel Hulu and put $50 in my emergency fund",
    needs: "rules",
    expect: { intent: "multi", avoid: /\bdone\b/i },
  },

  // Everything Jane did (spec step 187).
  {
    id: "timeline-1",
    text: "show me everything you did",
    needs: "rules",
    expect: { intent: "timeline" },
  },
  { id: "timeline-2", text: "why did you do that", needs: "rules", expect: { intent: "timeline" } },

  // Two questions in one message get both answers (spec step 193).
  {
    id: "two-1",
    text: "how much can I spend and when is payday",
    needs: "rules",
    expect: { figures: safe, mentions: /acme|payday/i, list: true, maxChars: 900 },
  },
  {
    id: "two-2",
    text: "what subscriptions do I have and what's due this week",
    needs: "rules",
    expect: { list: true, maxChars: 1_400 },
  },

  // Where the balance is heading, a budget for a category, a sector follow-up, saving more and
  // the month so far (QA's live sweep).
  {
    id: "fc-1",
    text: "why is my checking going negative",
    needs: "rules",
    expect: { intent: "balance_forecast", link: "/bills", list: true, maxChars: 900 },
  },
  {
    id: "fc-2",
    text: "set a budget for restaurants",
    needs: "rules",
    expect: { intent: "spending", button: "budget.set" },
  },
  {
    id: "fc-3",
    text: "what about my student loans",
    needs: "rules",
    expect: { intent: "student_loans", list: true, maxChars: 1_200 },
  },
  {
    id: "wi-2",
    text: "what if I save $200 more a month",
    needs: "rules",
    expect: { intent: "save_more", mentions: /\$2,400\.00 a year/ },
  },
  {
    id: "wi-3",
    text: "how did I do this month",
    needs: "rules",
    expect: { intent: "monthly_report" },
  },

  // Net worth, answered at once from the net worth page's own math.
  {
    id: "nw-1",
    text: "what's my net worth",
    needs: "rules",
    expect: { intent: "net_worth", mentions: /net worth is -?\$/, link: "/net-worth" },
  },
  {
    id: "nw-2",
    text: "how much am i worth",
    needs: "rules",
    expect: { intent: "net_worth", mentions: /net worth is -?\$/ },
  },

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

  // Guided flows (spec step 95): the first question, a button each.
  {
    id: "flow-1",
    text: "set up a budget",
    needs: "rules",
    expect: { intent: "flow", button: "flow.pick.1", mentions: /1 of 2/ },
  },
  {
    id: "flow-2",
    text: "dispute a charge",
    needs: "rules",
    expect: { intent: "flow", button: "flow.pick.1", mentions: /Which charge/ },
  },

  // Decision questions: answered from their debts, cushion and goals, never from a lookup of
  // the thing, and "should I buy?" is about the thing just discussed (never an old button).
  {
    id: "dec-1",
    text: "should i buy bitcoin",
    needs: "rules",

    sector: "decision",
    page: "/afford",
    tool: "decision",
    profile: "demo_advice",
    expect: {
      intent: "decision",
      mentions: /cushion/,
      avoid: /don't see any crypto|demo exchange|button opens|opens your/i,
    },
  },
  {
    id: "dec-1b",
    text: "should i buy?",
    needs: "rules",
    after: "dec-1",
    sector: "decision",
    page: "/afford",
    tool: "decision",
    profile: "demo_advice",
    expect: {
      intent: "decision",
      mentions: /bitcoin/i,
      avoid: /don't see any crypto|demo exchange|button opens|opens your/i,
    },
  },
  {
    id: "dec-2",
    text: "should i pay off my card or invest",
    needs: "rules",

    sector: "decision",
    page: "/afford",
    tool: "decision",
    profile: "demo_advice",
    expect: {
      intent: "decision",
      mentions: /cushion|credit card|% a year/,
      avoid: /don't see any crypto|demo exchange|button opens|opens your/i,
    },
  },
  {
    id: "dec-3",
    text: "should i buy a house",
    needs: "rules",

    sector: "decision",
    page: "/afford",
    tool: "decision",
    profile: "demo_advice",
    expect: {
      intent: "decision",
      mentions: /down payment/,
      avoid: /don't see any crypto|demo exchange|button opens|opens your/i,
    },
  },
  {
    id: "dec-4",
    text: "should i buy a car",
    needs: "rules",

    sector: "decision",
    page: "/afford",
    tool: "decision",
    profile: "demo_advice",
    expect: {
      intent: "decision",
      mentions: /insurance, fuel/,
      avoid: /don't see any crypto|demo exchange|button opens|opens your/i,
    },
  },
  {
    id: "dec-5",
    text: "should i invest",
    needs: "rules",

    sector: "decision",
    page: "/afford",
    tool: "decision",
    profile: "demo_advice",
    expect: {
      intent: "decision",
      mentions: /cushion/,
      avoid: /don't see any crypto|demo exchange|button opens|opens your/i,
    },
  },
  {
    id: "dec-6",
    text: "should i buy stocks",
    needs: "rules",

    sector: "decision",
    page: "/afford",
    tool: "decision",
    profile: "demo_advice",
    expect: {
      intent: "decision",
      mentions: /cushion/,
      avoid: /don't see any crypto|demo exchange|button opens|opens your/i,
    },
  },
  {
    id: "dec-7",
    text: "is it a good idea to buy crypto",
    needs: "rules",

    sector: "decision",
    page: "/afford",
    tool: "decision",
    profile: "demo_advice",
    expect: {
      intent: "decision",
      mentions: /cushion/,
      avoid: /don't see any crypto|demo exchange|button opens|opens your/i,
    },
  },
  {
    id: "dec-8",
    text: "should i buy tesla stock",
    needs: "rules",

    sector: "decision",
    page: "/afford",
    tool: "decision",
    profile: "demo_advice",
    expect: {
      intent: "decision",
      mentions: /cushion/,
      avoid: /don't see any crypto|demo exchange|button opens|opens your/i,
    },
  },

  // Short replies and 'why?' (QA sweep): answered at once, never by an old button.
  {
    id: "qa-yes",
    text: "yes",
    needs: "rules",
    sector: "chat",
    page: "/home",
    tool: "safe_to_spend",
    expect: {
      intent: "ack",
      mentions: /tap|what would you like/i,
    },
  },
  {
    id: "qa-no",
    text: "no thanks",
    needs: "rules",
    sector: "chat",
    page: "/home",
    tool: "safe_to_spend",
    expect: {
      intent: "ack",
      mentions: /leave it/i,
    },
  },
  {
    id: "qa-remind",
    text: "remind me tomorrow",
    needs: "rules",
    sector: "chat",
    page: "/home",
    tool: "safe_to_spend",
    expect: {
      intent: "remind",
      mentions: /tomorrow|remind/i,
    },
  },
  {
    id: "qa-cushion",
    text: "how much should i have in an emergency fund",
    needs: "rules",
    sector: "chat",
    page: "/home",
    tool: "safe_to_spend",
    expect: {
      intent: "decision",
      mentions: /cushion/i,
    },
  },
  {
    id: "qa-month",
    text: "what happened to my money this month",
    needs: "rules",
    sector: "chat",
    page: "/home",
    tool: "safe_to_spend",
    expect: {
      intent: "spending",
      mentions: /spent|spending/i,
    },
  },
  {
    id: "qa-why",
    text: "why?",
    needs: "rules",
    after: "dec-1",
    sector: "chat",
    page: "/home",
    tool: "safe_to_spend",
    expect: {
      mentions: /bitcoin|where you stand/i,
    },
  },

  // A finding talked about doesn't turn the next, unrelated question into a follow-up on it.
  {
    id: "unrelated-1",
    text: "what's my net worth",
    needs: "rules",
    after: "follow-2",
    sector: "follow",
    page: "/net-worth",
    tool: "net_worth",
    expect: { intent: "net_worth", avoid: /hulu|button/i },
  },
  {
    id: "unrelated-2",
    text: "how can i pay less interest",
    needs: "claude",
    after: "follow-2",
    sector: "follow",
    page: "/debt",
    tool: "card_interest",
    expect: { avoid: /hulu|\bbutton\b|under this answer/i },
  },
  // After a switch offer: a follow-up about options is a question, answered from the quotes,
  // never about a button that could not be set up.
  {
    id: "reshop-1",
    text: "can you change my car insurance",
    needs: "claude",
    sector: "insurance",
    page: "/insurance",
    tool: "propose_action",
    profile: "demo_advice",
    expect: { button: "insurance.shop_yes", avoid: /couldn't set up|where you stand/i },
  },
  {
    id: "reshop-2",
    text: "what are some other options from geico",
    needs: "claude",
    after: "reshop-1",
    sector: "insurance",
    page: "/insurance",
    tool: "insurance_quotes",
    profile: "demo_advice",
    expect: { mentions: /\$/, noButtons: true, avoid: /couldn't set up|button/i },
  },
  // The shapes batch 2 found weakest: a hard moment, a rambling message, a run of follow-ups.
  {
    id: "shape-emo",
    text: "i just lost my job",
    needs: "claude",
    sector: "emotional",
    page: "/home",
    tool: "safe_to_spend",
    profile: "demo_advice",
    expect: { mentions: /\$/, noButtons: true, maxChars: 650, avoid: /sorry to hear|\n- /i },
  },
  {
    id: "shape-emo2",
    text: "my partner and i are fighting about money",
    needs: "claude",
    sector: "emotional",
    page: "/home",
    tool: "safe_to_spend",
    profile: "demo_advice",
    expect: { mentions: /\$/, noButtons: true, maxChars: 650, avoid: /sorry to hear|\n- /i },
  },
  {
    id: "shape-long",
    text: "so basically i make about 4k a month and my rent is 1500 and i have a car payment and a couple of cards and i never seem to have anything left at the end of the month, can you tell me whats going on and what i should do first",
    needs: "claude",
    sector: "long",
    page: "/home",
    tool: "spending_by_category",
    profile: "demo_advice",
    expect: { mentions: /\$/, noButtons: true, maxChars: 700, avoid: /rephrase|where you stand/i },
  },
  {
    id: "shape-run-1",
    text: "i just got paid",
    needs: "claude",
    sector: "multi2",
    page: "/home",
    tool: "safe_to_spend",
    profile: "demo_advice",
    expect: { mentions: /\$/, noButtons: true },
  },
  {
    id: "shape-run-2",
    text: "how much can i spend now",
    needs: "claude",
    after: "shape-run-1",
    sector: "multi2",
    page: "/home",
    tool: "safe_to_spend",
    profile: "demo_advice",
    expect: { mentions: /\$/, noButtons: true, avoid: /covered .* above|as I said/i },
  },
  {
    id: "shape-run-3",
    text: "and for fun money",
    needs: "claude",
    after: "shape-run-1",
    sector: "multi2",
    page: "/home",
    tool: "safe_to_spend",
    profile: "demo_advice",
    expect: {
      mentions: /\$/,
      noButtons: true,
      avoid: /covered .* above|as I said|which one do you mean/i,
    },
  },
  // Voice (QA sweep): answers in words first, no talk of buttons or of earlier failures.
  {
    id: "voice-1",
    text: "explain my budget like i'm 5",
    needs: "claude",
    sector: "chat",
    page: "/budgets",
    tool: "budgets",
    expect: {
      avoid:
        /\b(?:I(?:'ve| have) put|button|never answered|I said I'd|earlier (?:question|message))\b/i,
    },
  },
  {
    id: "voice-2",
    text: "tell me about my spending in simple words",
    needs: "claude",
    sector: "chat",
    page: "/transactions",
    tool: "spending_by_category",
    expect: { avoid: /\b(?:I(?:'ve| have) put|under this answer|never answered)\b/i },
  },

  // Today's live failures, as must-pass questions for the depth bar.
  {
    id: "dbar-wrong",
    text: "what's one thing i'm doing wrong",
    needs: "rules",
    sector: "chat",
    page: "/home",
    tool: "priorities",
    expect: { intent: "priorities", avoid: /button|couldn't look/i },
  },
  {
    id: "dbar-why",
    text: "why?",
    needs: "rules",
    after: "follow-2",
    sector: "follow",
    page: "/subscriptions",
    tool: "finding_details",
    expect: { mentions: /If you say yes/i, avoid: /which one do you mean|button/i },
  },
  {
    id: "dbar-more",
    text: "tell me more",
    needs: "rules",
    after: "follow-2",
    sector: "follow",
    page: "/subscriptions",
    tool: "finding_details",
    expect: { mentions: /If you say yes/i, avoid: /which one do you mean|button/i },
  },
  {
    id: "debt-moves",
    text: "how can i pay less interest",
    needs: "claude",
    sector: "debt",
    page: "/debt",
    tool: "card_interest",
    profile: "demo_advice",
    expect: {
      mentions: /\$\d/,
      avoid: /open the (?:debt|debts) page|under this answer|\bbutton\b/i,
    },
  },

  // The founder's live transcript, exactly, and the same questions in other words.
  {
    id: "decf-1",
    text: "yea so should i be buying bitcoin",
    needs: "rules",
    sector: "decision",
    page: "/afford",
    tool: "decision",
    profile: "demo_advice",
    expect: {
      intent: "decision",
      mentions: /owe|cushion|credit card|where you stand/i,
      avoid: /don"t see any crypto|demo exchange|button|link below|Which one do you mean/i,
    },
  },
  {
    id: "decf-2",
    text: "why",
    needs: "rules",
    after: "decf-1",
    sector: "decision",
    page: "/afford",
    tool: "decision",
    profile: "demo_advice",
    expect: {
      mentions: /Next step|ask me about bitcoin/i,
      avoid: /don"t see any crypto|demo exchange|button|link below|Which one do you mean/i,
    },
  },
  {
    id: "decf-3",
    text: "yea so should i buy bitcoin",
    needs: "rules",
    after: "decf-1",
    sector: "decision",
    page: "/afford",
    tool: "decision",
    profile: "demo_advice",
    expect: {
      intent: "decision",
      mentions: /owe|cushion|credit card|where you stand/i,
      avoid: /don"t see any crypto|demo exchange|button|link below|Which one do you mean/i,
    },
  },
  {
    id: "decp-1",
    text: "should i get some btc",
    needs: "rules",
    sector: "decision",
    page: "/afford",
    tool: "decision",
    profile: "demo_advice",
    expect: {
      intent: "decision",
      mentions: /owe|cushion|credit card|where you stand/i,
      avoid: /don"t see any crypto|demo exchange|button|link below|Which one do you mean/i,
    },
  },
  {
    id: "decp-2",
    text: "is crypto a good idea for me",
    needs: "rules",
    sector: "decision",
    page: "/afford",
    tool: "decision",
    profile: "demo_advice",
    expect: {
      intent: "decision",
      mentions: /owe|cushion|credit card|where you stand/i,
      avoid: /don"t see any crypto|demo exchange|button|link below|Which one do you mean/i,
    },
  },
  {
    id: "decp-3",
    text: "hey, should i be investing in ethereum",
    needs: "rules",
    sector: "decision",
    page: "/afford",
    tool: "decision",
    profile: "demo_advice",
    expect: {
      intent: "decision",
      mentions: /owe|cushion|credit card|where you stand/i,
      avoid: /don"t see any crypto|demo exchange|button|link below|Which one do you mean/i,
    },
  },
  {
    id: "decp-4",
    text: "i'm thinking about buying some stocks",
    needs: "rules",
    sector: "decision",
    page: "/afford",
    tool: "decision",
    profile: "demo_advice",
    expect: {
      intent: "decision",
      mentions: /owe|cushion|credit card|where you stand/i,
      avoid: /don"t see any crypto|demo exchange|button|link below|Which one do you mean/i,
    },
  },
  {
    id: "decp-5",
    text: "is it a good idea to buy a house",
    needs: "rules",
    sector: "decision",
    page: "/afford",
    tool: "decision",
    profile: "demo_advice",
    expect: {
      intent: "decision",
      mentions: /owe|cushion|credit card|where you stand/i,
      avoid: /don"t see any crypto|demo exchange|button|link below|Which one do you mean/i,
    },
  },
  {
    id: "decp-6",
    text: "would buying a car be smart",
    needs: "rules",
    sector: "decision",
    page: "/afford",
    tool: "decision",
    profile: "demo_advice",
    expect: {
      intent: "decision",
      mentions: /owe|cushion|credit card|where you stand/i,
      avoid: /don"t see any crypto|demo exchange|button|link below|Which one do you mean/i,
    },
  },
  {
    id: "decp-7",
    text: "is it better to invest or pay off debt",
    needs: "rules",
    sector: "decision",
    page: "/afford",
    tool: "decision",
    profile: "demo_advice",
    expect: {
      intent: "decision",
      mentions: /owe|cushion|credit card|where you stand/i,
      avoid: /don"t see any crypto|demo exchange|button|link below|Which one do you mean/i,
    },
  },
  {
    id: "decp-8",
    text: "do you think i should buy bitcoin",
    needs: "rules",
    sector: "decision",
    page: "/afford",
    tool: "decision",
    profile: "demo_advice",
    expect: {
      intent: "decision",
      mentions: /owe|cushion|credit card|where you stand/i,
      avoid: /don"t see any crypto|demo exchange|button|link below|Which one do you mean/i,
    },
  },

  // QA's casual phrasing (lower case, filler, typos) and follow-ups after Claude's answers.
  {
    id: "casual-1",
    text: "uh should i just cancel netflix or whatever",
    needs: "claude",
    sector: "casual",
    page: "/subscriptions",
    tool: "subscriptions",
    profile: "demo_advice",
    expect: {
      mentions: /netflix/i,
      avoid:
        /\\bbutton\\b|link below|under this answer|couldn't look into that|Which one do you mean/i,
    },
  },
  {
    id: "casual-2",
    text: "why",
    needs: "claude",
    after: "casual-1",
    sector: "casual",
    page: "/subscriptions",
    tool: "finding_details",
    profile: "demo_advice",
    expect: {
      mentions: /\\$\\d/,
      avoid:
        /\\bbutton\\b|link below|under this answer|couldn't look into that|Which one do you mean/i,
    },
  },
  {
    id: "casual-3",
    text: "netflix worth keeping??",
    needs: "claude",
    sector: "casual",
    page: "/subscriptions",
    tool: "subscriptions",
    profile: "demo_advice",
    expect: {
      mentions: /netflix/i,
      avoid:
        /\\bbutton\\b|link below|under this answer|couldn't look into that|Which one do you mean/i,
    },
  },
  {
    id: "casual-4",
    text: "can u explain my budget in simple words",
    needs: "claude",
    sector: "casual",
    page: "/budgets",
    tool: "budgets",
    profile: "demo_advice",
    expect: {
      avoid:
        /\\bbutton\\b|link below|under this answer|couldn't look into that|Which one do you mean/i,
    },
  },
  {
    id: "casual-5",
    text: "ok and?",
    needs: "claude",
    after: "casual-4",
    sector: "casual",
    page: "/budgets",
    tool: "budgets",
    profile: "demo_advice",
    expect: {
      avoid:
        /\\bbutton\\b|link below|under this answer|couldn't look into that|Which one do you mean/i,
    },
  },
  {
    id: "casual-6",
    text: "pls explain my money situashun like im five",
    needs: "claude",
    sector: "casual",
    page: "/home",
    tool: "whole_picture",
    profile: "demo_advice",
    expect: {
      avoid:
        /\\bbutton\\b|link below|under this answer|couldn't look into that|Which one do you mean/i,
    },
  },
  {
    id: "casual-7",
    text: "so what am i doin wrong with money",
    needs: "claude",
    sector: "casual",
    page: "/home",
    tool: "priorities",
    profile: "demo_advice",
    expect: {
      mentions: /\\$\\d/,
      avoid:
        /\\bbutton\\b|link below|under this answer|couldn't look into that|Which one do you mean/i,
    },
  },
  {
    id: "casual-8",
    text: "what do you mean",
    needs: "claude",
    after: "casual-7",
    sector: "casual",
    page: "/home",
    tool: "priorities",
    profile: "demo_advice",
    expect: {
      avoid:
        /\\bbutton\\b|link below|under this answer|couldn't look into that|Which one do you mean/i,
    },
  },
  {
    id: "casual-9",
    text: "ok what do i do first",
    needs: "claude",
    sector: "casual",
    page: "/home",
    tool: "priorities",
    profile: "demo_advice",
    expect: {
      mentions: /\\$\\d/,
      avoid:
        /\\bbutton\\b|link below|under this answer|couldn't look into that|Which one do you mean/i,
    },
  },
  {
    id: "casual-10",
    text: "wher shuld i start",
    needs: "claude",
    sector: "casual",
    page: "/home",
    tool: "priorities",
    profile: "demo_advice",
    expect: {
      mentions: /\\$\\d/,
      avoid:
        /\\bbutton\\b|link below|under this answer|couldn't look into that|Which one do you mean/i,
    },
  },
  {
    id: "casual-11",
    text: "how do i stop paying so much interest",
    needs: "claude",
    sector: "casual",
    page: "/debt",
    tool: "card_interest",
    profile: "demo_advice",
    expect: {
      mentions: /\\$\\d/,
      avoid:
        /\\bbutton\\b|link below|under this answer|couldn't look into that|Which one do you mean/i,
    },
  },
  {
    id: "casual-12",
    text: "what do you mean",
    needs: "claude",
    after: "casual-11",
    sector: "casual",
    page: "/debt",
    tool: "card_interest",
    profile: "demo_advice",
    expect: {
      avoid:
        /\\bbutton\\b|link below|under this answer|couldn't look into that|Which one do you mean/i,
    },
  },
  {
    id: "casual-13",
    text: "is crypto a good idea for me",
    needs: "claude",
    sector: "casual",
    page: "/afford",
    tool: "decision",
    profile: "demo_advice",
    expect: {
      mentions: /\\$\\d/,
      avoid:
        /\\bbutton\\b|link below|under this answer|couldn't look into that|Which one do you mean/i,
    },
  },
  {
    id: "casual-14",
    text: "ok and?",
    needs: "claude",
    after: "casual-13",
    sector: "casual",
    page: "/afford",
    tool: "decision",
    profile: "demo_advice",
    expect: {
      avoid:
        /\\bbutton\\b|link below|under this answer|couldn't look into that|Which one do you mean/i,
    },
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
  { id: "free-2", text: "am I on track this month", needs: "rules", expect: WHOLE },
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
    text: "should I itemize",
    needs: "rules",
    expect: { intent: "decision", mentions: /\$16,100/ },
  },
  // Phase AF (spec steps 165–173).
  {
    id: "tax-16",
    text: "what state taxes do I pay",
    needs: "rules",
    expect: { intent: "tax", mentions: /state taxes come to/i },
  },
  {
    id: "tax-17",
    text: "what's my tax plan",
    needs: "rules",
    expect: { intent: "tax", mentions: /tax moves? left/i, list: true },
  },
  {
    id: "tax-18",
    text: "am I ready for an audit",
    needs: "rules",
    expect: { intent: "tax", mentions: /audit pack/i },
  },
  {
    id: "tax-19",
    text: "should we file jointly or separately",
    needs: "rules",
    expect: { intent: "tax", mentions: /family tax/i },
  },
  {
    id: "tax-20",
    text: "should I use a donor-advised fund",
    needs: "rules",
    expect: { intent: "tax", mentions: /charity/i },
  },
  {
    id: "tax-21",
    text: "does the salt cap limit my property tax deduction",
    needs: "rules",
    expect: { intent: "tax", mentions: /state and local tax/i },
  },
  {
    id: "tax-22",
    text: "did I miss anything on my return",
    needs: "rules",
    expect: { intent: "tax", mentions: /return/i },
  },
  {
    id: "tax-23",
    text: "what are the taxes on my rental income",
    needs: "rules",
    expect: { intent: "tax", mentions: /rent|rental/i },
  },
  {
    id: "tax-24",
    text: "what tax forms do I need",
    needs: "rules",
    expect: { intent: "tax", mentions: /W-2/, list: true },
  },
  {
    id: "tax-25",
    text: "I got a letter from the IRS",
    needs: "rules",
    expect: { intent: "tax", mentions: /letter from the IRS|tax notice/i },
  },
  {
    id: "tax-26",
    text: "how do I get an IP PIN",
    needs: "rules",
    expect: { intent: "tax", mentions: /Identity Protection PIN/ },
  },
  {
    id: "tax-27",
    text: "how are my crypto gains taxed",
    needs: "rules",
    expect: { intent: "tax", mentions: /crypto|exchange/i },
  },
  {
    id: "tax-28",
    text: "how will my taxes look over the next few years",
    needs: "rules",
    expect: { intent: "tax", mentions: /federal tax over the next/, list: true },
  },

  // Insurance (spec step 108), over the demo bank's sample GEICO car policy
  // (DEMO_POLICY in src/lib/insurance/profile.ts: $142.00 a month, a $1,000.00 deductible).
  {
    id: "tax-29",
    text: "is my property tax too high",
    needs: "rules",
    expect: { intent: "tax", mentions: /assessed at/i, list: true },
  },
  {
    id: "tax-30",
    text: "how do I share my taxes with my accountant",
    needs: "rules",
    expect: { intent: "tax", mentions: /link/, list: true },
  },
  {
    id: "tax-31",
    text: "what's happening with my taxes this month",
    needs: "rules",
    expect: { intent: "tax", mentions: /tax calendar for/, list: true },
  },
  {
    id: "tax-32",
    text: "should I become an S corp",
    needs: "rules",
    expect: { intent: "tax", mentions: /profit/ },
  },
  {
    id: "tax-33",
    text: "I inherited an IRA, what do I do",
    needs: "rules",
    expect: { intent: "tax", mentions: /step-up|new cost basis|10 years/, list: true },
  },
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
    expect: { intent: "decision", mentions: /deductible/i },
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

  // Investments (spec steps 128–137), on the demo bank in demo advice mode.
  {
    id: "inv-1",
    text: "what do I own",
    needs: "rules",
    expect: { intent: "investments", figures: invested, link: "/investments", list: true },
  },
  {
    id: "inv-2",
    text: "what's in my 401k",
    needs: "rules",
    expect: {
      intent: "investments",
      figures: inAccount("401(k)"),
      list: true,
      mentions: /401\(k\)/,
    },
  },
  {
    id: "inv-3",
    text: "what are my investment fees",
    needs: "rules",
    expect: { intent: "investments", link: "/investments/fees", list: true, maxChars: 1_600 },
  },
  {
    id: "inv-4",
    text: "review my portfolio",
    needs: "rules",
    expect: { intent: "investments", link: "/investments/review", list: true, maxChars: 1_600 },
  },
  {
    id: "inv-5",
    text: "am I on track for retirement",
    needs: "rules",
    expect: {
      intent: "investments",
      link: "/investments/retirement",
      list: true,
      maxChars: 1_800,
      mentions: /match/i,
      avoid: /\b(?:guarantee|will have)\b/i,
    },
  },
  {
    id: "inv-6",
    text: "rebalance",
    needs: "rules",
    expect: {
      intent: "investments",
      button: "invest.rebalance",
      mentions: /simulated/i,
      maxChars: 1_200,
    },
  },
  {
    id: "inv-7",
    text: "which account should I invest in first",
    needs: "rules",
    expect: { intent: "investments", link: "/investments/accounts", list: true, maxChars: 2_400 },
  },
  {
    id: "inv-8",
    text: "invest automatically",
    needs: "rules",
    expect: { intent: "investments", button: "invest.auto_start", mentions: /safe to spend/i },
  },
  {
    id: "inv-9",
    text: "what's my risk profile",
    needs: "rules",
    expect: { intent: "investments", mentions: /medium/i, link: "/investments/profile" },
  },
  {
    id: "inv-10",
    text: "what is an index fund",
    needs: "rules",
    expect: { intent: "learn", link: "/learn/index-funds" },
  },
  {
    id: "inv-11",
    text: "how are my investments doing",
    needs: "rules",
    expect: {
      intent: "investments",
      figures: invested,
      avoid: /\b(?:will (?:rise|fall|go)|expect|forecast|predict)\w*/i,
    },
  },
  {
    id: "inv-12",
    text: "what do you do with my investments",
    needs: "rules",
    expect: { intent: "investments", mentions: /by myself/i, link: "/settings" },
  },
  {
    id: "inv-13",
    text: "should I buy more of my company's stock",
    needs: "claude",
    expect: { avoid: /\byou should (?:buy|sell)\b/i },
  },

  // Loans and debt (spec steps 109–117): every debt question answered by the rules.
  {
    id: "debt-1",
    text: "how much do I owe",
    needs: "rules",
    expect: {
      intent: "debts",
      mentions: /net worth/i,
      link: "/loans",
      list: true,
      maxChars: 1_400,
    },
  },
  {
    id: "debt-2",
    text: "when is my car paid off",
    needs: "rules",
    expect: { intent: "debt_detail", mentions: /paid off by/i, link: "/loans" },
  },
  {
    id: "debt-3",
    text: "what's the rate on my student loan",
    needs: "rules",
    expect: { intent: "debt_detail", mentions: /5\.25%.*from your bank/i },
  },
  {
    id: "debt-4",
    text: "what's the fastest way out of debt",
    needs: "rules",
    expect: {
      intent: "payoff_plan",
      mentions: /debt-free by/i,
      button: "debt_plan.avalanche",
      list: true,
      maxChars: 1_200,
    },
  },
  {
    id: "debt-5",
    text: "what if I pay $200 more a month on my debts",
    needs: "rules",
    expect: { intent: "payoff_plan", mentions: /\$200\.00 extra/i, list: true, maxChars: 1_200 },
  },
  {
    id: "debt-6",
    text: "can I refinance my car loan",
    needs: "rules",
    expect: { intent: "refinance", mentions: /same/i, button: "loan.prepare", maxChars: 1_200 },
  },
  {
    id: "debt-7",
    text: "should I do a balance transfer",
    needs: "rules",
    expect: {
      intent: "balance_transfer",
      mentions: /fee/i,
      button: "transfer.start",
      maxChars: 900,
    },
  },
  {
    id: "debt-8",
    text: "which student loan plan should I be on",
    needs: "rules",
    expect: {
      intent: "student_loans",
      mentions: /forgiveness/i,
      link: "https://studentaid.gov/",
      list: true,
      maxChars: 1_200,
    },
  },
  {
    id: "debt-9",
    text: "can I get rid of PMI",
    needs: "rules",
    expect: { intent: "mortgage", mentions: /PMI/, link: "/loans/mortgage", maxChars: 1_200 },
  },
  {
    id: "debt-10",
    text: "what's my credit score",
    needs: "rules",
    expect: {
      intent: "credit_score",
      mentions: /stand-in/i,
      link: "/loans/credit",
      list: true,
      maxChars: 1_200,
    },
  },
  {
    id: "debt-11",
    text: "how's my loan application",
    needs: "rules",
    expect: { intent: "loan_status", mentions: /application/i },
  },
  {
    id: "debt-12",
    text: "when are my loan payments due",
    needs: "rules",
    expect: {
      intent: "debt_due",
      mentions: /next debt payment/i,
      link: "/loans",
      list: true,
      maxChars: 1_000,
    },
  },
  {
    id: "debt-13",
    text: "what do you do about my debts",
    needs: "rules",
    expect: {
      intent: "debt_autopilot",
      mentions: /by myself/i,
      link: "/settings",
      list: true,
      maxChars: 2_200,
    },
  },
  // Spec step 174: which card for what, whether a fee pays for itself, a better card.
  {
    id: "debt-14",
    text: "which card should I use for groceries",
    needs: "rules",
    expect: { intent: "card_for", mentions: /for groceries/i, link: "/loans/cards" },
  },
  {
    id: "debt-15",
    text: "is my annual fee worth it",
    needs: "rules",
    expect: { intent: "card_fee", mentions: /pay for itself/i, link: "/loans/cards" },
  },
  {
    id: "debt-16",
    text: "what's the best credit card for me",
    needs: "rules",
    expect: {
      intent: "card_better",
      mentions: /hard credit check/i,
      button: "credit_card.apply",
      link: "/loans/cards",
    },
  },
  // Spec step 227: a credit score needed by a date.
  {
    id: "debt-30",
    text: "I need a 740 credit score for a mortgage in 6 months",
    needs: "rules",
    expect: {
      intent: "credit_goal",
      mentions: /simulator/i,
      button: "creditgoal.start",
      link: "/loans/goal",
      list: true,
      maxChars: 1_000,
    },
  },
  // Spec step 245: the car loan you already have.
  {
    id: "debt-34",
    text: "can I cancel the extended warranty on my car loan",
    needs: "rules",
    expect: {
      intent: "car_loan",
      mentions: /car loan|refinanc/i,
      link: "/loans/auto",
      maxChars: 1_500,
    },
  },
  // Spec step 230: the yearly debt review, one message with a button for each item.
  {
    id: "debt-33",
    text: "do my yearly debt review",
    needs: "rules",
    expect: {
      intent: "debt_review",
      mentions: /statement/i,
      link: "/loans/review",
      list: true,
      maxChars: 1_600,
    },
  },
  // Spec step 229: when debt is too much, the facts without advice.
  {
    id: "debt-32",
    text: "I have too much debt, what are my options",
    needs: "rules",
    expect: {
      intent: "debt_trouble",
      mentions: /hardship/i,
      link: "/loans/help",
      list: true,
      maxChars: 3_200,
    },
  },
  // Straight answers to debt and credit decisions: three sentences or fewer, from the
  // person's own numbers (src/planning/debt-decisions.ts).
  {
    id: "debt-41",
    text: "should I pay off my card or invest?",
    needs: "rules",
    expect: {
      intent: "decision",
      mentions: /invest/i,
      link: "/loans",
      maxSentences: 3,
      maxChars: 700,
    },
  },
  {
    id: "debt-42",
    text: "should I consolidate my debt?",
    needs: "rules",
    expect: {
      intent: "decision",
      mentions: /cards?/i,
      link: "/loans",
      maxSentences: 3,
      maxChars: 700,
    },
  },
  {
    id: "debt-43",
    text: "should I use my savings to pay off my cards?",
    needs: "rules",
    expect: {
      intent: "decision",
      mentions: /cash/i,
      link: "/loans",
      maxSentences: 3,
      maxChars: 700,
    },
  },
  {
    id: "debt-44",
    text: "should I close a credit card?",
    needs: "rules",
    expect: {
      intent: "decision",
      mentions: /limit/i,
      link: "/loans",
      maxSentences: 3,
      maxChars: 700,
    },
  },
  {
    id: "debt-46",
    text: "will paying off my card hurt my credit?",
    needs: "rules",
    expect: {
      intent: "debt_decision",
      mentions: /doesn't hurt/i,
      link: "/loans",
      maxSentences: 3,
      maxChars: 700,
    },
  },
  {
    id: "debt-47",
    text: "should I take a personal loan to pay off my cards?",
    needs: "rules",
    expect: {
      intent: "decision",
      mentions: /cards?/i,
      link: "/loans",
      maxSentences: 3,
      maxChars: 700,
    },
  },
  {
    id: "debt-48",
    text: "should I take a payday loan?",
    needs: "rules",
    expect: {
      intent: "decision",
      mentions: /a year/i,
      link: "/loans",
      maxSentences: 3,
      maxChars: 700,
    },
  },
  {
    id: "debt-49",
    text: "should I pay off my student loan early?",
    needs: "rules",
    expect: {
      intent: "decision",
      mentions: /student|loan|nothing to pay down/i,
      link: "/loans",
      maxSentences: 3,
      maxChars: 700,
    },
  },
  {
    id: "debt-50",
    text: "should I pay extra on my mortgage or invest?",
    needs: "rules",
    expect: {
      intent: "debt_decision",
      mentions: /invest|nothing to pay down/i,
      link: "/loans",
      maxSentences: 3,
      maxChars: 700,
    },
  },
  {
    id: "debt-51",
    text: "what about a personal loan?",
    needs: "rules",
    after: "debt-42",
    expect: {
      intent: "debt_decision",
      mentions: /cards?/i,
      link: "/loans",
      maxSentences: 3,
      maxChars: 700,
    },
  },
  {
    id: "debt-52",
    text: "and what if I consolidate instead?",
    needs: "rules",
    after: "debt-41",
    expect: {
      intent: "debt_decision",
      mentions: /cards?/i,
      link: "/loans",
      maxSentences: 3,
      maxChars: 700,
    },
  },
  {
    id: "debt-45",
    text: "will paying it off hurt my credit?",
    needs: "rules",
    after: "debt-44",
    expect: {
      intent: "debt_decision",
      mentions: /doesn't hurt/i,
      link: "/loans",
      maxSentences: 3,
      maxChars: 700,
    },
  },
  // The affordability decisions, three sentences or fewer.
  {
    id: "debt-53",
    text: "will I overdraft this month?",
    needs: "rules",
    expect: {
      intent: "debt_decision",
      mentions: /below zero|above zero|checking/i,
      link: "/loans/tight",
      maxSentences: 3,
      maxChars: 700,
    },
  },
  {
    id: "debt-54",
    text: "should I use buy now pay later?",
    needs: "rules",
    expect: {
      intent: "decision",
      mentions: /Pay in 4/i,
      link: "/loans",
      maxSentences: 3,
      maxChars: 700,
    },
  },
  {
    id: "debt-55",
    text: "can I afford a car?",
    needs: "rules",
    expect: {
      intent: "car_afford",
      mentions: /comfortable car|afford a car/i,
      link: "/loans/car",
      maxSentences: 3,
      maxChars: 700,
    },
  },
  // The perfect fit for borrowing (spec step 283): the pick and the options to choose from.
  {
    id: "debt-65",
    text: "what's the best loan for me?",
    needs: "rules",
    expect: {
      intent: "loan_fit",
      mentions: /personal|loan/i,
      link: "/loans",
      list: true,
      maxChars: 900,
    },
  },
  {
    id: "debt-66",
    text: "which loan should I get to consolidate my cards?",
    needs: "rules",
    expect: {
      intent: "loan_fit",
      mentions: /cards|consolidat|loan/i,
      link: "/loans",
      list: true,
      maxChars: 900,
    },
  },
  {
    id: "debt-67",
    text: "what's the best car loan for $20,000?",
    needs: "rules",
    expect: {
      intent: "loan_fit",
      mentions: /car loan|\\$20,000/i,
      link: "/loans",
      list: true,
      maxChars: 900,
    },
  },
  // Follow-ups on the best loan (spec step 284), from loan_fit's reason for the pick and the
  // lender's other terms, the differences already worked out.
  {
    id: "debt-68",
    text: "why that one?",
    needs: "claude",
    after: "debt-67",
    sector: "loans",
    page: "/loans",
    tool: "loan_fit",
    profile: "demo_advice",
    expect: {
      mentions: /in all|total|cost|cheap|less|payment/i,
      avoid: /\bbutton\b|apply for you|I can't tell/i,
    },
  },
  {
    id: "debt-69",
    text: "what about a shorter term?",
    needs: "claude",
    after: "debt-67",
    sector: "loans",
    page: "/loans",
    tool: "loan_fit",
    profile: "demo_advice",
    expect: {
      mentions: /a month/i,
      avoid: /\bbutton\b|apply for you|I can't tell/i,
    },
  },
  // Spending, saving and housing decisions, three sentences or fewer.
  {
    id: "debt-56",
    text: "how much should I save each month?",
    needs: "rules",
    expect: {
      intent: "debt_decision",
      mentions: /save|income/i,
      link: "/goals",
      maxSentences: 3,
      maxChars: 700,
    },
  },
  {
    id: "debt-57",
    text: "should I rent or buy?",
    needs: "rules",
    expect: {
      intent: "debt_decision",
      mentions: /rent|home|income/i,
      link: "/loans/home",
      maxSentences: 3,
      maxChars: 700,
    },
  },
  {
    id: "debt-58",
    text: "can I afford a house?",
    needs: "rules",
    expect: {
      intent: "home_afford",
      mentions: /28\/36|income/i,
      link: "/loans/home",
      maxSentences: 3,
      maxChars: 700,
    },
  },
  {
    id: "debt-59",
    text: "can I afford a $2,000 vacation?",
    needs: "rules",
    expect: {
      intent: "afford",
      mentions: /short|Yes|tight|fits/i,
      link: "/afford",
      maxSentences: 3,
      maxChars: 700,
    },
  },
  {
    id: "debt-60",
    text: "can I afford a $1,500 laptop?",
    needs: "rules",
    expect: {
      intent: "afford",
      mentions: /short|Yes|tight|fits/i,
      link: "/afford",
      maxSentences: 3,
      maxChars: 700,
    },
  },
  {
    id: "debt-61",
    text: "what subscriptions do I have?",
    needs: "rules",
    expect: {
      intent: "subscriptions",
      mentions: /subscriptions/i,
      link: "/subscriptions",
      maxSentences: 3,
      maxChars: 700,
    },
  },
  {
    id: "debt-62",
    text: "am I spending too much on food?",
    needs: "rules",
    expect: {
      intent: "spending",
      mentions: /food/i,
      link: "/",
      maxSentences: 3,
      maxChars: 700,
    },
  },
  {
    id: "debt-63",
    text: "where does my money go?",
    needs: "rules",
    expect: {
      intent: "spending",
      mentions: /spent|went/i,
      link: "/",
      maxSentences: 3,
      maxChars: 700,
    },
  },
  {
    id: "debt-64",
    text: "how much can I spend this month?",
    needs: "rules",
    expect: {
      intent: "safe_to_spend",
      mentions: /safe to spend/i,
      link: "/",
      maxSentences: 3,
      maxChars: 700,
    },
  },
  // Spec step 228: a home's equity, used well.
  {
    id: "debt-31",
    text: "heloc or cash-out refinance for a $40,000 kitchen",
    needs: "rules",
    expect: {
      intent: "home_equity",
      mentions: /total cost/i,
      link: "/loans/equity",
      list: true,
      maxChars: 1_400,
    },
  },
  // Spec step 226: money between family and friends, kept kindly.
  {
    id: "debt-29",
    text: "who owes me money",
    needs: "rules",
    expect: {
      intent: "family_loans",
      mentions: /owe|lent|loan/i,
      link: "/loans/family",
      maxChars: 1_200,
    },
  },
  // Spec step 225: the long game on student loans.
  {
    id: "debt-28",
    text: "how many PSLF payments have I made",
    needs: "rules",
    expect: {
      intent: "student_long",
      mentions: /Public Service Loan Forgiveness/i,
      link: "/loans/student",
      list: true,
      maxChars: 1_600,
    },
  },
  // Spec step 224: less interest on every card.
  {
    id: "debt-27",
    text: "how much interest am I paying on my cards",
    needs: "rules",
    expect: {
      intent: "card_interest",
      mentions: /interest/i,
      button: "cardrate.send",
      link: "/loans/interest",
      list: true,
      maxChars: 1_200,
    },
  },
  // Spec step 181: collections and credit report errors, with letters to fix them.
  {
    id: "debt-26",
    text: "there's a collection on my credit report",
    needs: "rules",
    expect: {
      intent: "report_fixes",
      mentions: /credit report/i,
      button: "creditfix.send",
      link: "/loans/report",
      list: true,
      maxChars: 1_000,
    },
  },
  // Spec step 180: medical bills found and the requests written for them.
  {
    id: "debt-25",
    text: "can you check my medical bills",
    needs: "rules",
    expect: {
      intent: "medical_bills",
      mentions: /medical bills?/i,
      link: "/loans/medical",
      list: true,
      maxChars: 1_000,
    },
  },
  // Spec step 179: buying a home, from saving to closing.
  {
    id: "debt-24",
    text: "how much house can I afford",
    needs: "rules",
    expect: {
      intent: "home_afford",
      mentions: /28\/36/i,
      button: "home.goal",
      link: "/loans/home",
      list: true,
      maxChars: 1_600,
    },
  },
  // Spec step 178: buying a car, and a dealer's financing checked against preapprovals.
  {
    id: "debt-22",
    text: "how much car can I afford",
    needs: "rules",
    expect: {
      intent: "car_afford",
      mentions: /cheapest preapproval/i,
      link: "/loans/car",
      list: true,
      maxChars: 1_000,
    },
  },
  {
    id: "debt-23",
    text: "the dealer offered 8.99% for 60 months on $30,000",
    needs: "rules",
    expect: {
      intent: "car_dealer",
      mentions: /dealer's financing/i,
      link: "/loans/car",
      list: true,
    },
  },
  // Spec step 177: a tight month.
  {
    id: "debt-21",
    text: "money is tight this month",
    needs: "rules",
    expect: { intent: "tight_money", mentions: /cushion/i, link: "/loans/tight", maxChars: 1_000 },
  },
  // Spec step 176: buy now, pay later installments and a new plan's warning.
  {
    id: "debt-19",
    text: "what buy now pay later payments do I have coming",
    needs: "rules",
    expect: {
      intent: "bnpl",
      mentions: /installments over the next month/i,
      link: "/loans",
      list: true,
      maxChars: 1_200,
    },
  },
  {
    id: "debt-20",
    text: "can I afford a $300 Klarna plan",
    needs: "rules",
    expect: { intent: "bnpl_new", mentions: /four payments of/i, link: "/loans" },
  },
  // Spec step 175: building credit and the labelled score simulator.
  {
    id: "debt-17",
    text: "how do I build my credit",
    needs: "rules",
    expect: {
      intent: "build_credit",
      mentions: /statement closes/i,
      link: "/loans/credit",
      list: true,
      maxChars: 1_000,
    },
  },
  {
    id: "debt-18",
    text: "what would my score be if I paid off my card",
    needs: "rules",
    expect: {
      intent: "credit_simulate",
      mentions: /estimates/i,
      link: "/loans/credit",
      list: true,
      maxChars: 1_200,
    },
  },

  // Insurance: paying less for the same cover (spec step 196), over the demo person's GEICO
  // policy: four ways that keep the cover (about $388.80 a year added up) and a higher
  // deductible that lowers it ($170.40).
  {
    id: "sav-1",
    text: "how can I pay less for my car insurance",
    needs: "rules",
    expect: {
      intent: "insurance",
      figures: () => [38_880],
      mentions: /your cover stays exactly as it is/,
      link: "/insurance",
      list: true,
      maxChars: 1_100,
    },
  },
  {
    id: "sav-2",
    text: "is it cheaper to pay my car insurance yearly",
    needs: "rules",
    expect: {
      intent: "insurance",
      figures: () => [13_320],
      mentions: /once a year/,
      list: true,
      maxChars: 1_100,
    },
  },
  // Risks seen in how they live (spec step 197): the demo bank has one signal of each kind,
  // asked one at a time, newest first.
  {
    id: "risk-1",
    text: "what risks do you see in my insurance",
    needs: "rules",
    expect: { intent: "insurance", mentions: /I saw \$[\d,.]+/, maxChars: 500 },
  },
  {
    id: "risk-2",
    text: "what am i missing in my insurance",
    needs: "rules",
    expect: { intent: "insurance", mentions: /\?/, maxChars: 500 },
  },
  {
    id: "sav-3",
    text: "are there any discounts on my insurance",
    needs: "rules",
    expect: { intent: "insurance", mentions: /autopay/i, list: true, maxChars: 1_100 },
  },

  // Claim or pay yourself (spec step 199): the payout is a fact; the comparison is demo advice.
  {
    id: "claim-1",
    text: "is it worth claiming a $1,200 repair on my car",
    needs: "rules",
    expect: { intent: "insurance", mentions: /deductible/i, maxChars: 700 },
  },
  {
    id: "claim-2",
    text: "should I file a claim for $300 of damage",
    needs: "rules",
    expect: { intent: "insurance", mentions: /under your .* deductible/i, maxChars: 700 },
  },

  // Health cover all year (spec step 200): facts from the plan's terms and their spending.
  {
    id: "hy-1",
    text: "how much of my deductible have I met",
    needs: "rules",
    expect: { intent: "insurance", mentions: /of your .* deductible/i, maxChars: 900 },
  },
  {
    id: "hy-2",
    text: "how much is left in my fsa",
    needs: "rules",
    expect: { intent: "insurance", mentions: /FSA/, maxChars: 900 },
  },
  {
    id: "hy-3",
    text: "when will I hit my out of pocket max",
    needs: "rules",
    expect: { intent: "insurance", mentions: /out-of-pocket maximum/i, maxChars: 900 },
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

// Sectors whose answers may give recommendations in demo advice mode (CLAUDE.md, step 98),
// so their answers are checked with the "demo_advice" guardrail profile.
const ADVICE_SECTORS = new Set([
  "insurance",
  "taxes",
  "investing",
  "hsa",
  "giving",
  "student",
  "loans",
  "credit",
]);

const MORE_QUESTIONS: readonly CheckQuestion[] = MORE_ROWS.map(
  ([sector, page, tool, text], index): CheckQuestion => ({
    id: `more-${String(index + 1).padStart(3, "0")}`,
    text,
    needs: "claude",
    expect: {
      ...(sector === "edge" ? { avoid: ADVICE } : {}),
      ...(tool === "propose_action" ? {} : { noButtons: true }),
    },
    sector,
    page,
    tool,
    profile: ADVICE_SECTORS.has(sector) ? "demo_advice" : "standard",
  }),
);

// Insurance decisions in the chat: the questions people really ask before buying, switching
// or claiming. Each gets a direct answer of three sentences or fewer from the person's own
// numbers (src/lib/jane-agent/insurance/decisions.ts), with the demo advice label. Must pass.
const DECISIONS: readonly (readonly [string, string, RegExp, string?])[] = [
  ["insd-1", "should I get umbrella insurance", /umbrella/i],
  ["insd-2", "do I need life insurance", /depend/i],
  ["insd-3", "should I switch car insurance", /Lighthouse|cheaper/i],
  ["insd-4", "should I file a claim for a $1,200 repair on my car", /\$200\.00/],
  ["insd-5", "what if the repair is $3,000", /\$2,000\.00/, "insd-4"],
  ["insd-6", "is my car insurance too expensive", /\$1,704\.00/],
  ["insd-7", "should I raise the deductible on my car insurance", /\$2,000\.00|deductible/i],
  ["insd-8", "do I have enough car insurance", /\$50,000\.00/],
  ["insd-9", "do I need renters insurance", /home/i],
  ["insd-10", "should I pay my car insurance yearly", /\$133\.20/],
  ["insd-11", "what happens if I get in an accident", /911/],
  ["insd-12", "can you get me a better price on my car insurance", /\$408\.00/],
  ["insd-13", "do I need disability insurance", /disability/i],
  ["insd-14", "do I need pet insurance", /pet/i],
  ["insd-15", "should I bundle my car and home insurance", /home/i],
  ["insd-16", "am I covered if I drive for Uber", /driving for pay|rideshare/i],
  ["insd-17", "is my home insurance enough", /home/i],
  ["insd-18", "how much life insurance do I need", /depend/i],
  ["insd-19", "should I cancel my phone insurance", /Asurion|card/i],
  ["insd-20", "do I need travel insurance", /trip|travel/i],
  ["insd-21", "should I keep my employer's health plan", /\$3,480\.00/],
  ["insd-22", "do I lose my FSA money at the end of the year", /\$2,400\.00/],
  ["insd-23", "have I hit my deductible", /\$500\.00/],
  ["insd-24", "what's my out of pocket max", /\$3,000\.00/],
  ["insd-25", "why is my insurance going up", /\$1,704\.00|renews/i],
  ["insd-26", "what's the cheapest way to cover my car", /\$408\.00/],
  ["insd-27", "should I add my teenager to my policy", /driver/i],
  ["insd-28", "do I need business insurance for my side hustle", /work|business/i],
  ["insd-29", "how much would it cost to switch car insurance", /nothing|\$1,296\.00/],
  ["insd-30", "do I need an umbrella policy", /umbrella/i],
  ["insd-31", "do I have enough life insurance", /life/i],
  ["insd-32", "how much life insurance do I need", /depend|\$[\d,]+/i],
  ["insd-33", "how much disability insurance do I need", /\$[\d,.]+ a month/],
  ["insd-34", "how much umbrella insurance do I need", /umbrella|net worth/i],
  ["insd-35", "how much liability insurance do I need on my car", /liability/i],
];

// "Should I ...?" with insurance words goes through the decision router (src/config/decisions.ts).
const routed = (text: string) =>
  text.startsWith("should I") && SECTOR_DECISIONS.some((d) => d.pattern.test(text.toLowerCase()));

const DECISION_QUESTIONS: readonly CheckQuestion[] = DECISIONS.map(
  ([id, text, mentions, after]): CheckQuestion => ({
    id,
    text,
    needs: "rules",
    after,
    expect: { intent: routed(text) ? "decision" : "insurance", mentions, maxChars: 460 },
    sector: "insurance",
    page: "insurance",
    tool: "insurance_policies",
    profile: "demo_advice",
  }),
);

export const QUESTIONS: readonly CheckQuestion[] = [
  ...BASE_QUESTIONS,
  ...MORE_QUESTIONS,
  ...DECISION_QUESTIONS,
  ...TAX_QUESTIONS,
];

// Spec step 189: the sector a question belongs to: its own, or for the older ones the start
// of its id.
const GROUPS: Record<string, string> = {
  safe: "safe",
  due: "bills",
  pay: "income",
  act: "subs",
  follow: "follow",
  free: "free",
  out: "edge",
  tax: "taxes",
  ins: "insurance",
  insd: "insurance",
  inv: "investing",
  whole: "whole",
  multi: "multi",
  timeline: "timeline",
};

const sectorOf = (id: string) => GROUPS[id.split("-")[0]] ?? id.split("-")[0];
export const sectorOfQuestion = (q: CheckQuestion) => q.sector ?? sectorOf(q.id);
