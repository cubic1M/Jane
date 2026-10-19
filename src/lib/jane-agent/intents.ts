import { parseInsurance, type InsuranceIntent } from "./insurance/intents";
import { CHAT_WEEK_DAYS } from "@/config/agent-chat";
import type { LifeEventKind } from "@/config/life-events";
import { CATEGORY_LABELS, UNCATEGORIZED } from "@/insights/labels";
import { parseMoneyToCents } from "@/lib/money";
import { parseDebtIntent, type DebtIntent } from "./debt-intents";
import { parseTaxIntent, type TaxIntent } from "./tax-intents";
import type { PreferenceDraft } from "./preferences";
import { parseFact } from "./remember";
import { parseInvestmentIntent, type InvestmentIntent } from "./investments/intents";
import { parseSectorIntent, type SectorIntent } from "./autopilot-intents";
import { parseLearnIntent, type LearnIntent } from "./learn";

// What the person typed to Jane, understood by rules (spec step 84). Pure: the text and
// today's date in, one intent out. Works with no Claude key at all; anything it can't
// place is "unknown", which goes to Claude when there's a key.

// cancel: a subscription. lower: a bill, a rate or fees. refund: money back from a charge.
export type ActVerb = "cancel" | "lower" | "refund";

export type Intent =
  | { kind: "help" }
  // Loans and debt (spec Phase Y, ./debt-intents.ts).
  | DebtIntent
  // Insurance (spec Phase X): ./insurance/intents.ts.
  | InsuranceIntent
  // "hi", "thanks": answered at once, without Claude.
  | { kind: "greeting"; thanks: boolean }
  | { kind: "what_did" }
  // Spec step 97: "what changed?"
  | { kind: "changes" }
  // Spec step 100: "I'm moving", "I got a new job", "we're having a baby".
  | { kind: "life_event"; event: LifeEventKind }
  // Spec step 101: "how was my week?"
  | { kind: "review" }
  // Spec step 139: "how much have you saved me?"
  | { kind: "saved" }
  | { kind: "approve_all" }
  | { kind: "undo" }
  | { kind: "pause_autopilot" }
  // amountCents is null when no amount was given; month (YYYY-MM) null means now.
  // category: the person's words when they name a spending category ("food"), for the
  // answer to compare with what they usually spend and their budget. period: "this week"
  // or "a month" in the question; recurring: every month, not once.
  | {
      kind: "afford";
      amountCents: number | null;
      what: string | null;
      month: string | null;
      category: string | null;
      period: "week" | "month" | null;
      recurring: boolean;
    }
  | { kind: "safe_to_spend" }
  // category is the person's own words ("food"), matched loosely later; month YYYY-MM.
  | { kind: "spending"; category: string | null; month: string }
  // days is null for the usual coming-up list.
  | { kind: "coming_up"; days: number | null }
  // findingId: one finding exactly (a clarifying question's button, spec step 88).
  | { kind: "act"; verb: ActVerb; target: string; findingId?: string }
  // Spec step 88. What one thing costs ("how much is Netflix"); a year's cost when asked.
  | { kind: "cost"; target: string; year: boolean }
  // What's charged on a schedule: subscriptions, or everything (all: bills too). total:
  // "how much do I spend on subscriptions".
  | { kind: "subscriptions"; total: boolean; all: boolean }
  // The next paycheck.
  | { kind: "payday" }
  // A name on its own, or "tell me about …": a subscription or bill, something Jane found,
  // or a spending category, whichever it is (src/lib/jane-agent/answer.ts).
  | { kind: "about"; target: string; findingId?: string }
  // Spec step 91: something the person told Jane about themselves, to remember on a tap.
  | { kind: "remember"; draft: PreferenceDraft }
  // A follow-up: "and Hulu?", "what about last month?" (target or month): resolved against
  // what the conversation was about (./context.ts).
  | { kind: "follow_up"; target: string | null; month: string | null }
  // Taxes (spec steps 118–127): ./tax-intents.ts.
  | TaxIntent
  // Spec step 128 on: what they own, and each later investment question.
  | InvestmentIntent
  // Spec step 141: one autopilot, every sector.
  | SectorIntent
  // Spec step 136: what a word means.
  | LearnIntent
  | { kind: "unknown" };

const MONTHS = [
  "jan",
  "feb",
  "mar",
  "apr",
  "may",
  "jun",
  "jul",
  "aug",
  "sep",
  "oct",
  "nov",
  "dec",
] as const;

const MONTH_NAME =
  "(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)";
// A month name only counts after a word like "in" or "by", so "may I" isn't May.
const NAMED_MONTH = new RegExp(
  `\\b(?:in|by|for|during|this|next|last|until|of)\\s+${MONTH_NAME}\\b(?:\\s+(\\d{4}))?`,
);

// The month `by` months from `month` (YYYY-MM).
export function addMonths(month: string, by: number): string {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1 + by, 1)).toISOString().slice(0, 7);
}

// "in March", "next month", "last month", "in 3 months". A month name without a year is
// the next one coming (future) or the last one gone (past), counting this month as both.
export function parseMonth(
  text: string,
  asOf: string,
  direction: "future" | "past",
): string | null {
  const current = asOf.slice(0, 7);
  if (/\bthis month\b/.test(text)) return current;
  if (/\bnext month\b/.test(text)) return addMonths(current, 1);
  if (/\blast month\b/.test(text)) return addMonths(current, -1);
  const ahead = /\bin (\d{1,2}) months?\b/.exec(text);
  if (ahead && direction === "future") return addMonths(current, Number(ahead[1]));
  const named = NAMED_MONTH.exec(text);
  if (!named) return null;
  const index = MONTHS.indexOf(named[1].slice(0, 3) as (typeof MONTHS)[number]);
  const pad = String(index + 1).padStart(2, "0");
  if (named[2]) return `${named[2]}-${pad}`;
  const year = Number(asOf.slice(0, 4));
  const thisYear = `${year}-${pad}`;
  if (direction === "future") return thisYear >= current ? thisYear : `${year + 1}-${pad}`;
  return thisYear <= current ? thisYear : `${year - 1}-${pad}`;
}

// "$900", "900", "$1,200.50", "1.2k", "2 grand", "900 dollars". The first amount wins.
export function parseAmount(text: string): number | null {
  const scaled = /(?:^|[^\w.,])\$?\s?(\d+(?:\.\d+)?)\s?(k|grand|thousand)\b/.exec(text);
  if (scaled) return Math.round(Number(scaled[1]) * 100_000);
  const money = /\$\s?((?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d{1,2})?)/.exec(text);
  const bare = /(?:^|[^\w.,$])((?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d{1,2})?)\b/.exec(text);
  const found = money?.[1] ?? bare?.[1];
  if (!found) return null;
  const cents = parseMoneyToCents(found);
  return cents !== null && cents > 0 ? cents : null;
}

// Lowercase, plain quotes, one space, no polite openers or closing punctuation.
export function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[.!?\s]+$/, "")
    .replace(/^(?:hey |hi )?(?:jane[,:!]? )?/, "")
    .replace(
      /^(?:(?:please|pls|can you|could you|would you|i want to|i'd like to|i need to|help me) )+/,
      "",
    )
    .replace(/(?: for me| please)+$/, "")
    .replace(/[.!?\s]+$/, "")
    .trim();
}

// Spec step 88: short forms and common slips, word for word.
const SHORT_FORMS: Readonly<Record<string, string>> = {
  hw: "how",
  wat: "what",
  wht: "what",
  whats: "what's",
  hows: "how's",
  wheres: "where's",
  u: "you",
  ur: "your",
  r: "are",
  wk: "week",
  wks: "weeks",
  mo: "month",
  mth: "month",
  yr: "year",
  subs: "subscriptions",
  sub: "subscription",
  thx: "thanks",
  fod: "food",
  spnd: "spend",
  amt: "amount",
  bc: "because",
  "w/": "with",
};

// Words the rules look for, which a slip of one letter (a missing, extra, swapped or wrong
// letter) still finds. Only words of five letters or more, and none a different word is one
// letter from ("lower" and "power"), so a name or another word is never "corrected".
const VOCABULARY = [
  "afford",
  "spend",
  "spent",
  "spending",
  "cancel",
  "subscription",
  "subscriptions",
  "refund",
  "negotiate",
  "payday",
  "paycheck",
  "budget",
  "groceries",
  "restaurants",
  "upcoming",
  "autopilot",
  "approve",
  "insurance",
] as const;

// Damerau–Levenshtein distance of at most one (one letter added, dropped, changed or two
// swapped).
export function oneSlip(a: string, b: string): boolean {
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i += 1;
  const rest = (x: string, from: number) => x.slice(from);
  return (
    rest(a, i + 1) === rest(b, i + 1) ||
    rest(a, i + 1) === rest(b, i) ||
    rest(a, i) === rest(b, i + 1) ||
    (a[i] === b[i + 1] && a[i + 1] === b[i] && rest(a, i + 2) === rest(b, i + 2))
  );
}

// "safe 2 spend" → "safe to spend", "cancle hulu" → "cancel hulu", "hw much" → "how much".
export function fixTypos(text: string): string {
  return (
    text
      // "2" as "to" only before a verb, so "I have 2 kids" keeps its number.
      .replace(
        /(?<=[a-z]) 2 (?=(?:spend|pay|save|afford|cancel|get|go|buy|use|do|be|see)\b)/g,
        " to ",
      )
      .split(" ")
      .map((word) => {
        if (Object.hasOwn(SHORT_FORMS, word)) return SHORT_FORMS[word];
        if (word.length < 4 || (VOCABULARY as readonly string[]).includes(word)) return word;
        return VOCABULARY.find((v) => oneSlip(word, v)) ?? word;
      })
      .join(" ")
  );
}

// What to look for in the findings: no "my", no "subscription" or "bill" on the end.
function cleanTarget(text: string): string {
  return text
    .replace(/^(?:(?:my|the|our|a|an|that|this) )+/, "")
    .replace(
      /(?:^| )(?:subscriptions?|membership|bill|plan|account|charges?|service|payments?|thing)$/,
      "",
    )
    .trim();
}

// "a trip", "the new couch", "food": what the money is for, without the amount or the
// month. "for …" or "on …".
function purchaseOf(text: string): string | null {
  const match =
    /\b(?:for|on) ((?:a |an |the |my |our |some )?[a-z][a-z' -]{0,40}?)(?= (?:in|by|next|this|on|during|until|at|a|per|each|every|monthly|weekly)\b|$)/.exec(
      text,
    );
  // Or "can I afford a vacation".
  const named =
    match ??
    /\bafford ((?:a|an|the|some) [a-z][a-z' -]{0,40}?)(?= (?:in|by|next|this|on|during|until|at)\b|$)/.exec(
      text,
    );
  if (!named) return null;
  const what = named[1].trim();
  return /\d/.test(what) ? null : what;
}

const GREETING =
  /^(?:(?:hi|hello|hey|hiya|howdy|yo|sup|morning|good (?:morning|afternoon|evening))(?: there)?(?: jane)?|jane)$/;
const THANKS =
  /^(?:thanks|thank you|thx|ty|cheers|ok thanks|okay thanks|great thanks|got it thanks)(?: so much| a lot)?(?: jane)?$/;
const HELP =
  /^(?:help|\?|commands|menu|what can (?:you|i) (?:do|ask|say|type)(?: here)?|how does this work)$/;
const PAUSE = /\b(?:pause|stop|turn off|switch off|disable) (?:the |my )?autopilot\b/;
const WHAT_DID =
  /\bwhat (?:did|have) you (?:do|done|been (?:doing|up to))\b|\bwhat'?s new\b|\banything new\b|\bwhat happened\b|\bwhat are you (?:doing|working on)\b/;
const CHANGES =
  /\bwhat(?:'s| has| have)? changed\b|\b(?:has|have) (?:anything|something) changed\b|\bany(?:thing)? (?:changes?|different|unusual)\b|\bwhat'?s different\b|\bnoticed anything\b/;
const LIFE: readonly [LifeEventKind, RegExp][] = [
  [
    "moving",
    /\b(?:i'?m|i am|we'?re|we are) (?:moving|relocating)\b|\b(?:i|we) (?:just )?moved\b|\bmoving (?:house|out|home)\b/,
  ],
  [
    "new_job",
    /\b(?:got|started|start|landed|accepted|starting) (?:a |my )?new job\b|\bi'?m changing jobs\b/,
  ],
  [
    "new_baby",
    /\b(?:having|expecting|had) a baby\b|\b(?:i'?m|we'?re|i am|we are) (?:pregnant|expecting)\b|\bnew baby\b/,
  ],
];
const SAVED =
  /\bhow much (?:have you|has jane|did you) saved? me\b|\bwhat (?:have you|did you) save(?:d)? me\b|\bmy savings so far\b|\btotal (?:you'?ve )?saved\b/;
const REVIEW =
  /\b(?:weekly review|week in review|how was my week|how did my week go|recap(?: my| the| of my)? week|my week(?: so far)?)\b/;
const APPROVE_ALL =
  /\b(?:yes to (?:all|everything)|approve (?:them all|all|everything|the safe ones|the safe stuff|safe ones))\b/;
const UNDO = /^(?:undo|undo (?:that|it|the last one)|take (?:that|it) back)$/;
// Asking whether a purchase is OK without the word "afford": "can I spend $500 on food
// this week", "should I buy a $1,200 laptop", "is it ok to spend 300 on clothes", "do I
// have enough for a $900 trip". Only with an amount; without one, "how much can I spend"
// is safe to spend.
const AFFORD_ASK =
  /^(?:so )?(?:can|could|should|may|shall|would) (?:i|we) (?:spend|buy|get|pay|put|book|go|splurge|drop|blow|use)\b|^(?:is it|would it be|will it be|is that) (?:ok|okay|fine|safe|alright|smart|wise|a good idea) (?:to|if i|if we) (?:spend|buy|pay|get|book|use)\b|^(?:do|will|would) (?:i|we) have (?:enough|room|money)\b/;
// Every month, not once: "$500 a month", "monthly". "In a month" is a date, not a pace.
const RECURRING = /(?<!\bin )\b(?:a|per|each|every) month\b|\bmonthly\b/;
const WEEK = /\b(?:this|a|per|each|every|next) week\b|\bweekly\b/;
const CATEGORY_LIST = [...new Set([...Object.values(CATEGORY_LABELS), UNCATEGORIZED])];

const SAFE =
  /\bsafe to spend\b|\bhow much (?:can|could) i (?:still )?spend\b|\bwhat can i (?:still )?spend\b|\bspending money left\b|\bhow much (?:money )?(?:do )?i (?:have|got) (?:left|to spend|left to spend)\b|\bhow much (?:money )?(?:is|do i have) left\b/;
const SPENDING = /\b(?:spent|spend|spending)\b|\bwhere (?:does|did) (?:all )?my money go\b/;
const COMING_UP =
  /\bwhat'?s (?:due|coming(?: up)?|next)\b|\bcoming up\b|\bupcoming\b|\bbills? (?:due|coming)\b|\bwhat do i (?:owe|have to pay)\b|\bdue (?:this|next) week\b/;
// Spec step 88.
const PAYDAY = /\b(?:pay ?days?|pay ?checks?|get(?:ting)? paid|salary|wages|next pay)\b/;
const SUBSCRIPTIONS =
  /\bsubscriptions\b|\bsubscription list\b|\bwhat (?:am i|do i) pay(?:ing)? for\b|\b(?:recurring|regular|monthly) (?:charges|payments|bills)\b|\bwhat (?:charges|bills) me\b/;
const ALL_RECURRING =
  /\bwhat (?:am i|do i) pay(?:ing)? for\b|\b(?:recurring|regular|monthly) (?:charges|payments|bills)\b|\bwhat (?:charges|bills) me\b/;
const COST = [
  /^how much (?:is|are|was|does|do) (?:i pay for |i spend for |i pay )?(.+?)(?: cost(?: me| us)?)?(?: (?:a|per|each|every) (month|year))?$/,
  /^how much (?:am i paying|do i pay|i pay) (?:for )?(.+?)(?: (?:a|per|each|every) (month|year))?$/,
  /^what (?:does|do|is|are) (.+?) cost(?: me| us)?(?: (?:a|per|each|every) (month|year))?$/,
  /^what(?:'s| is) (?:the )?(?:cost|price) (?:of|for) (.+?)(?: (?:a|per|each|every) (month|year))?$/,
  /^what do i pay (?:for )?(.+?)(?: (?:a|per|each|every) (month|year))?$/,
];
const ABOUT =
  /^(?:tell me (?:more )?about|what(?:'s| is| was) (?:up with|going on with)|explain|what about|show me|details on|info on) (.+)$/;
// "and Hulu?", "what about last month?", "same for Peacock".
const FOLLOW =
  /^(?:and|what about|how about|same for|same with|also|ok and|and what about|and how about)(?: for| on| at| with)? (.+)$/;
// "last month", "in August", "september 2026": a month and nothing else.
const MONTH_ONLY = new RegExp(
  `^(?:(?:in|for|during) )?(?:(?:this|last|next) month|${MONTH_NAME}(?: \\d{4})?)$`,
);
// Words that point back at what the conversation was about.
export const PRONOUNS: readonly string[] = [
  "it",
  "that",
  "this",
  "that one",
  "this one",
  "them",
  "those",
];
// A name on its own is at most this many words.
const ABOUT_MAX_WORDS = 3;

const REFUND =
  /^(?:i )?(?:get|want|need|request|ask for|claim) (?:my |a |the )?(?:money back|refund) (?:from|for|on|at) (.+)$|^refund (?:from |for |my )?(.+)$/;
const CANCEL =
  /^(?:cancel|unsubscribe(?: from)?|stop(?: paying(?: for)?)?|end|get rid of|drop|quit) (.+)$/;
const LOWER = /^(?:lower|reduce|cut|negotiate|bring down|shrink) (.+)$/;

export function parseIntent(raw: string, asOf: string): Intent {
  const text = fixTypos(normalize(raw));
  if (!text || HELP.test(text)) return { kind: "help" };
  if (GREETING.test(text)) return { kind: "greeting", thanks: false };
  if (THANKS.test(text)) return { kind: "greeting", thanks: true };
  if (PAUSE.test(text)) return { kind: "pause_autopilot" };
  const sector = parseSectorIntent(text);
  if (sector) return sector;
  if (SAVED.test(text)) return { kind: "saved" };
  if (REVIEW.test(text)) return { kind: "review" };
  if (CHANGES.test(text)) return { kind: "changes" };
  // Spec step 165: a move that names the states ("I moved from California to New York in
  // June") is for the state taxes; "I just moved" is the moving checklist's.
  const taxMove = parseTaxIntent(text);
  if (taxMove?.ask === "move") return taxMove;
  const life = LIFE.find(([, pattern]) => pattern.test(text));
  if (life) return { kind: "life_event", event: life[0] };
  if (WHAT_DID.test(text)) return { kind: "what_did" };
  if (APPROVE_ALL.test(text)) return { kind: "approve_all" };
  if (UNDO.test(text)) return { kind: "undo" };
  // Spec step 136: "what's a deductible?" is a question about the word, before the sectors.
  const learn = parseLearnIntent(text);
  if (learn) return learn;
  // Loans and debt (spec Phase Y) before taxes: "how much do I owe?" is about debts;
  // anything that mentions taxes is left to the tax questions.
  const debt = parseDebtIntent(text, parseAmount(text));
  if (debt) return debt;
  const tax = parseTaxIntent(text);
  if (tax) return tax;

  // Spec step 91: something they're telling Jane, not asking.
  const fact = parseFact(text);
  if (fact) return { kind: "remember", draft: fact };

  // Spec step 88: a follow-up to what was just said: another month, or another name.
  const follow = FOLLOW.exec(text);
  if (follow) {
    const words = follow[1];
    if (MONTH_ONLY.test(words)) {
      const month = parseMonth(
        /^(?:in|for|during) /.test(words) ? words : `in ${words}`,
        asOf,
        "past",
      );
      if (month) return { kind: "follow_up", target: null, month };
    }
    return { kind: "follow_up", target: cleanTarget(words), month: null };
  }

  if (/\bafford\b/.test(text) || (AFFORD_ASK.test(text) && parseAmount(text) !== null)) {
    const what = purchaseOf(text);
    const recurring = RECURRING.test(text);
    return {
      kind: "afford",
      amountCents: parseAmount(text),
      what,
      month: parseMonth(text, asOf, "future"),
      category: what && matchCategory(what, CATEGORY_LIST) ? what : null,
      period: WEEK.test(text) ? "week" : recurring || /\bthis month\b/.test(text) ? "month" : null,
      recurring,
    };
  }
  if (SAFE.test(text)) return { kind: "safe_to_spend" };
  // Spec step 128 on: after affording, so "can I afford … my 401(k)" stays a money question.
  const investments = parseInvestmentIntent(text);
  if (investments) return investments;
  // Spec step 88: paydays, subscriptions and what one thing costs.
  const acting = REFUND.test(text) || CANCEL.test(text) || LOWER.test(text);
  if (!acting && PAYDAY.test(text)) return { kind: "payday" };
  if (!acting && SUBSCRIPTIONS.test(text)) {
    return {
      kind: "subscriptions",
      total: /\bhow much\b|\btotal\b|\bin all\b|\badd up\b/.test(text),
      all: ALL_RECURRING.test(text),
    };
  }
  // Insurance questions ("how much is my home insurance") are the insurance lane's own.
  if (!acting && !SPENDING.test(text)) {
    const insurance = parseInsurance(text);
    if (insurance) return insurance;
  }
  for (const pattern of COST) {
    const cost = pattern.exec(text);
    if (!cost) continue;
    const target = cleanTarget(cost[1]);
    // "How much is safe to spend" and "how much do I owe" belong elsewhere.
    if (target && !SPENDING.test(target) && !/^(?:due|coming up|left|owed?)$/.test(target)) {
      return { kind: "cost", target, year: cost[2] === "year" };
    }
  }
  if (SPENDING.test(text)) {
    const on = /\b(?:on|for|at) (.+?)(?= (?:this|last|in|during|so far|since)\b|$)/.exec(text);
    const category = on ? cleanTarget(on[1]) : "";
    return {
      kind: "spending",
      category: category && !/^(?:month|week|year)$/.test(category) ? category : null,
      month: parseMonth(text, asOf, "past") ?? asOf.slice(0, 7),
    };
  }
  if (COMING_UP.test(text)) {
    return { kind: "coming_up", days: /\bthis week\b/.test(text) ? CHAT_WEEK_DAYS : null };
  }

  const refund = REFUND.exec(text);
  if (refund) return { kind: "act", verb: "refund", target: cleanTarget(refund[1] ?? refund[2]) };
  const cancel = CANCEL.exec(text);
  if (cancel) return { kind: "act", verb: "cancel", target: cleanTarget(cancel[1]) };
  const lower = LOWER.exec(text);
  if (lower) return { kind: "act", verb: "lower", target: cleanTarget(lower[1]) };

  const insurance = parseInsurance(text);
  if (insurance) return insurance;

  const about = ABOUT.exec(text);
  if (about) return { kind: "about", target: cleanTarget(about[1]) };
  // A name on its own ("netflix", "the bank fees").
  if (/^[a-z][a-z0-9&+' -]*$/.test(text) && text.split(" ").length <= ABOUT_MAX_WORDS) {
    const target = cleanTarget(text);
    if (target) return { kind: "about", target };
  }
  return { kind: "unknown" };
}

// Everyday words for the spending categories (src/insights/labels.ts), so "food" finds
// "Food and drink" and "gas" finds "Transportation".
const CATEGORY_WORDS: Readonly<Record<string, readonly string[]>> = {
  "Food and drink": [
    "food",
    "eating",
    "eating out",
    "restaurants",
    "restaurant",
    "dining",
    "dining out",
    "groceries",
    "grocery",
    "coffee",
    "takeout",
    "take out",
    "lunch",
    "dinner",
    "drinks",
    "bars",
  ],
  Shopping: ["shopping", "stuff", "clothes", "clothing", "merchandise", "stores"],
  Transportation: [
    "transport",
    "gas",
    "fuel",
    "uber",
    "lyft",
    "taxis",
    "rides",
    "car",
    "parking",
    "commute",
    "transit",
  ],
  Travel: ["trips", "flights", "hotels", "vacation", "vacations"],
  "Rent and utilities": ["rent", "utilities", "electric", "electricity", "water", "bills"],
  Entertainment: ["fun", "movies", "streaming", "games", "concerts"],
  Medical: ["health", "doctor", "doctors", "pharmacy", "dentist", "healthcare"],
  "Personal care": ["haircut", "haircuts", "beauty", "gym", "fitness", "salon"],
  Home: ["house", "home improvement", "furniture", "repairs"],
  "Bank fees and interest": ["fees", "bank fees", "interest"],
  Services: ["service"],
  "Government and donations": ["donations", "charity", "government"],
  "Loan payments": ["loans", "loan"],
};

// The category label the person meant, or null. Matched loosely: the label itself, a
// word from its list, or a label with a word that starts with what they typed.
export function matchCategory(query: string, labels: readonly string[]): string | null {
  const q = query.trim().toLowerCase();
  if (!q) return null;
  const exact = labels.find((l) => l.toLowerCase() === q);
  if (exact) return exact;
  const byWord = labels.find((l) => CATEGORY_WORDS[l]?.includes(q));
  if (byWord) return byWord;
  if (q.length >= 3) {
    const partial = labels.find((l) =>
      l
        .toLowerCase()
        .split(" ")
        .some((w) => w.length >= 3 && w.startsWith(q)),
    );
    if (partial) return partial;
  }
  return null;
}
