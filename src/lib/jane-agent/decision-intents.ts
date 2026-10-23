// "Should I buy bitcoin?", "should I pay off my card or invest?", "should I buy a house?"
// (decision questions): a question about what to do with money, answered from the person's own
// debts, cushion and goals (./decision.ts), never from a lookup of the thing itself. "Should I
// buy?" on its own is about whatever was just discussed. Pure.

import { SECTOR_DECISIONS } from "@/config/decisions";

export type CoreSubject =
  "crypto" | "stocks" | "invest" | "home" | "car" | "payoff_or_invest" | "other";

// What the question is about: a core subject or one a sector added (src/config/decisions.ts).
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export type DecisionItem = CoreSubject | (string & {});

export type DecisionIntent = {
  kind: "decision";
  // What kind of thing; null when they didn't say ("should I buy?").
  item: DecisionItem | null;
  // What they called it, for the answer's words ("bitcoin", "a house").
  label: string | null;
  // "Why?" right after the answer: the reason on its own, not the whole answer again.
  why?: boolean;
};

const CRYPTO = /\b(?:crypto\w*|bitcoin|btc|ether\w*|eth|solana|doge\w*|stablecoins?|nfts?)\b/;
const STOCKS = /\b(?:stocks?|shares?|etfs?|index funds?|mutual funds?|bonds?)\b/;
const HOME = /\b(?:house|home|condo|apartment|property|townhouse)\b/;
const CAR = /\b(?:car|truck|suv|vehicle|motorcycle)\b/;
// Other sectors answer these (cover, tax, a particular loan): left to them.
const OTHER_SECTOR =
  /\b(?:insurance|cover|warranty|tax\w*|refinanc\w*|mortgage|life|term|disability|umbrella|renters?|annuit\w*|ira|roth|401\s?k|hsa|529)\b/;

const PRICE = /\$\s?\d|\b\d[\d,.]*\s?(?:k|dollars|bucks|usd)\b/;

// What people put in front of a question ("yea so", "hey,", "do you think"): dropped before it
// is read, so the same question in other words is the same question.
const FILLER =
  /^(?:(?:yea|yeah|yep|yup|ok|okay|hey|hi|um|uh|well|so|and|but|hmm|like|also|actually|then|right|now)\b[\s,.!-]*)+/;
const LEAD =
  /^(?:do you think|would you say|what do you think|what would you say|can you tell me|tell me|i was wondering|i'?m wondering|im wondering|quick question|question)[,:]?\s*(?:if|whether)?\s*/;

const BARE = /^should i(?: buy| do it| buy it| go for it| get it)?$/;
const PAYOFF_OR_INVEST =
  /\b(?:pay(?:ing)? (?:off|down)\b.*\b(?:or|vs\.?|versus|instead of)\b.*\b(?:invest\w*|sav\w+)|(?:invest\w*|sav\w+)\b.*\b(?:or|vs\.?|versus|instead of)\b.*\bpay(?:ing)? (?:off|down))\b/;
// A question about doing something with money: "should I (be)", "I should", "is it worth", "is X
// a good idea (for me)", "thinking about buying", "would buying X be smart".
const ASKED = new RegExp(
  [
    "^(?:should (?:i|we)(?: be)?\\b)",
    "^(?:i|we) should\\b",
    "^is it (?:smart|wise|worth|ok|okay|safe|better|smarter|a good idea|a good move|a bad idea)\\b",
    "^would it be (?:smart|wise|ok|okay|a good idea)\\b",
    "^would (?:buying|getting|investing)\\b",
    "^(?:am i|are we) (?:crazy|dumb|silly) to\\b",
    "^(?:i'?m|im|we'?re) (?:thinking|considering|planning)(?: of| about| on)?\\b",
    "^(?:is|are) .{2,40}? (?:a good (?:idea|buy|investment|bet|move)|worth (?:it|buying|getting|investing)|smart|wise|safe)\\b",
    "^worth (?:buying|getting|investing)\\b",
  ].join("|"),
);
const BUY =
  /\b(?:buy(?:ing)?|purchas(?:e|ing)|invest(?:ing)? in|get(?:ting)?|put(?:ting)? (?:some |any )?(?:money|cash|savings|\$?\d[\d,]*) (?:in|into)|get(?:ting)? into|go(?:ing)? (?:big )?on)\s+(.+)$/;
const INVEST_BARE = /^(?:should i|i should) (?:start )?invest(?:ing)?$/;
const SUBJECT = new RegExp(`${CRYPTO.source}|${STOCKS.source}|${HOME.source}|${CAR.source}`);

const classify = (rest: string): DecisionItem =>
  CRYPTO.test(rest)
    ? "crypto"
    : STOCKS.test(rest)
      ? "stocks"
      : HOME.test(rest)
        ? "home"
        : CAR.test(rest)
          ? "car"
          : "other";

const tidy = (rest: string) =>
  rest
    .replace(/[?.!]+$/, "")
    .replace(/\b(?:for me|right now|these days|at the moment)\b/g, "")
    .replace(/^(?:some|any|a bit of|a little|more)\s+/, "")
    .replace(/\s+/g, " ")
    .trim();

export function parseDecision(raw: string): DecisionIntent | null {
  const text = raw.replace(FILLER, "").replace(LEAD, "").trim();
  if (BARE.test(text)) return { kind: "decision", item: null, label: null };
  // "Pay off debt or invest, which is smarter": a choice between the two is a question.
  if (
    !ASKED.test(text) &&
    !(PAYOFF_OR_INVEST.test(text) && /\b(?:should|better|smarter|smart|wise|which)\b/.test(text))
  )
    return null;
  // A sector's own subject (insurance, loans, taxes) comes before the general ones.
  const sector = SECTOR_DECISIONS.find((s) => s.pattern.test(text));
  if (sector) {
    const label = tidy(
      text.replace(
        /^.*?\b(?:should (?:i|we)(?: be)?|i should|good idea to|wise to|smart to)\s+/,
        "",
      ),
    );
    return { kind: "decision", item: sector.item, label };
  }
  if (PAYOFF_OR_INVEST.test(text)) {
    return { kind: "decision", item: "payoff_or_invest", label: "paying off debt or investing" };
  }
  if (INVEST_BARE.test(text)) return { kind: "decision", item: "invest", label: "investing" };
  // With a price it is "can I afford it", which has its own answer.
  if (PRICE.test(text) || OTHER_SECTOR.test(text)) return null;
  const buy = BUY.exec(text);
  if (buy) {
    const rest = tidy(buy[1]);
    if (!rest) return null;
    const item = classify(rest);
    // "Get" alone is too loose ("get a new credit card"): it needs a thing we know.
    if (/^get/.test(buy[0]) && item === "other") return null;
    return {
      kind: "decision",
      item: /^invest(?:ing)? in/.test(buy[0]) && item === "other" ? "invest" : item,
      label: rest,
    };
  }
  // "Is crypto a good idea for me?": no verb, but a subject we know.
  const subject = SUBJECT.exec(text);
  if (subject && /\b(?:good (?:idea|buy|investment|bet|move)|worth|smart|wise|safe)\b/.test(text))
    return { kind: "decision", item: classify(subject[0]), label: tidy(subject[0]) };
  return null;
}
