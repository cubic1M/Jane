// "Should I buy bitcoin?", "should I pay off my card or invest?", "should I buy a house?"
// (decision questions): a question about what to do with money, answered from the person's own
// debts, cushion and goals (./decision.ts), never from a lookup of the thing itself. "Should I
// buy?" on its own is about whatever was just discussed. Pure.

export type DecisionItem =
  "crypto" | "stocks" | "invest" | "home" | "car" | "payoff_or_invest" | "other";

export type DecisionIntent = {
  kind: "decision";
  // What kind of thing; null when they didn't say ("should I buy?").
  item: DecisionItem | null;
  // What they called it, for the answer's words ("bitcoin", "a house").
  label: string | null;
};

const CRYPTO = /\b(?:crypto\w*|bitcoin|btc|ether\w*|eth|solana|doge\w*|stablecoins?|nfts?)\b/;
const STOCKS = /\b(?:stocks?|shares?|etfs?|index funds?|mutual funds?|bonds?)\b/;
const HOME = /\b(?:house|home|condo|apartment|property|townhouse)\b/;
const CAR = /\b(?:car|truck|suv|vehicle|motorcycle)\b/;
// Other sectors answer these (cover, tax, a particular loan): left to them.
const OTHER_SECTOR = /\b(?:insurance|cover|warranty|tax\w*|refinanc\w*|mortgage)\b/;

const PRICE = /\$\s?\d|\b\d[\d,.]*\s?(?:k|dollars|bucks|usd)\b/;
const BARE = /^(?:so |ok |okay |and )?should i(?: buy| do it| buy it| go for it| get it)?$/;
const PAYOFF_OR_INVEST =
  /\b(?:pay(?:ing)? (?:off|down)\b.*\b(?:or|vs\.?|versus)\b.*\b(?:invest\w*|sav\w+)|(?:invest\w*|sav\w+)\b.*\b(?:or|vs\.?|versus)\b.*\bpay(?:ing)? (?:off|down))\b/;
const ASKED =
  /\bshould i\b|\bis it (?:smart|wise|a good idea) to\b|\bwould it be (?:smart|wise) to\b/;
const BUY =
  /\b(?:buy|purchase|invest in|put (?:some |any )?(?:money|cash|savings|\$?\d[\d,]*) (?:in|into)|get into|go (?:big )?on)\s+(.+)$/;
const INVEST_BARE = /\bshould i (?:start )?invest(?:ing)?$/;

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
    .replace(/^(?:some|any|a bit of|a little)\s+/, "")
    .trim();

export function parseDecision(text: string): DecisionIntent | null {
  if (BARE.test(text)) return { kind: "decision", item: null, label: null };
  if (!ASKED.test(text)) return null;
  if (PAYOFF_OR_INVEST.test(text)) {
    return { kind: "decision", item: "payoff_or_invest", label: "paying off debt or investing" };
  }
  if (INVEST_BARE.test(text)) return { kind: "decision", item: "invest", label: "investing" };
  const buy = BUY.exec(text);
  if (!buy) return null;
  const rest = tidy(buy[1]);
  // With a price it is "can I afford it", which has its own answer.
  if (!rest || OTHER_SECTOR.test(rest) || PRICE.test(text)) return null;
  const item = classify(rest);
  return {
    kind: "decision",
    item: /^invest in/.test(buy[0]) && item === "other" ? "invest" : item,
    label: rest,
  };
}
