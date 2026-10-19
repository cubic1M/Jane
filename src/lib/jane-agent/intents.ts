import { CHAT_WEEK_DAYS } from "@/config/agent-chat";
import { CATEGORY_LABELS, UNCATEGORIZED } from "@/insights/labels";
import { parseMoneyToCents } from "@/lib/money";
import { parseInvestmentIntent, type InvestmentIntent } from "./investments/intents";

// What the person typed to Jane, understood by rules (spec step 84). Pure: the text and
// today's date in, one intent out. Works with no Claude key at all; anything it can't
// place is "unknown", which goes to Claude when there's a key.

// cancel: a subscription. lower: a bill, a rate or fees. refund: money back from a charge.
export type ActVerb = "cancel" | "lower" | "refund";

export type Intent =
  | { kind: "help" }
  // "hi", "thanks": answered at once, without Claude.
  | { kind: "greeting"; thanks: boolean }
  | { kind: "what_did" }
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
  | { kind: "act"; verb: ActVerb; target: string }
  // Spec step 128 on: what they own, and each later investment question.
  | InvestmentIntent
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
  /\bsafe to spend\b|\bhow much (?:can|could) i (?:still )?spend\b|\bwhat can i (?:still )?spend\b|\bspending money left\b/;
const SPENDING = /\b(?:spent|spend|spending)\b/;
const COMING_UP =
  /\bwhat'?s (?:due|coming(?: up)?|next)\b|\bcoming up\b|\bupcoming\b|\bbills? (?:due|coming)\b|\bwhat do i (?:owe|have to pay)\b|\bdue (?:this|next) week\b/;
const REFUND =
  /^(?:i )?(?:get|want|need|request|ask for|claim) (?:my |a |the )?(?:money back|refund) (?:from|for|on|at) (.+)$|^refund (?:from |for |my )?(.+)$/;
const CANCEL = /^(?:cancel|unsubscribe(?: from)?|stop|end|get rid of|drop) (.+)$/;
const LOWER = /^(?:lower|reduce|cut|negotiate|bring down|shrink) (.+)$/;

export function parseIntent(raw: string, asOf: string): Intent {
  const text = normalize(raw);
  if (!text || HELP.test(text)) return { kind: "help" };
  if (GREETING.test(text)) return { kind: "greeting", thanks: false };
  if (THANKS.test(text)) return { kind: "greeting", thanks: true };
  if (PAUSE.test(text)) return { kind: "pause_autopilot" };
  if (WHAT_DID.test(text)) return { kind: "what_did" };
  if (APPROVE_ALL.test(text)) return { kind: "approve_all" };
  if (UNDO.test(text)) return { kind: "undo" };

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
