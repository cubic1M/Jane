// Questions about investments, understood by rules (spec step 128 on). Pure: the
// normalized text in (./../intents.ts normalize), the topic out, or null when it isn't
// about investments. Each investment step adds its topics here.

export type InvestmentTopic = "holdings" | "profile" | "fees";

export type InvestmentIntent = {
  kind: "investments";
  topic: InvestmentTopic;
  // The account the person named ("401k", "brokerage", "ira"), when they named one.
  account: string | null;
};

const ACCOUNT_WORDS =
  "401\\(?k\\)?|403\\(?b\\)?|roth ira|roth|ira|hsa|brokerage|retirement(?: account)?|investment account|portfolio";
const ACCOUNT = new RegExp(`\\b(${ACCOUNT_WORDS})(?=\\s|$|[^\\w])`);

const HOLDINGS = new RegExp(
  [
    "\\bwhat do i (?:own|hold|have invested)\\b",
    "\\bwhat am i invested in\\b",
    "\\bwhere (?:is|'s) my money invested\\b",
    "\\b(?:show|list|see)(?: me)? (?:my |what'?s in my )?(?:investments|holdings|portfolio|funds|stocks)\\b",
    "\\bmy (?:investments|holdings|portfolio|funds|stocks|shares)\\b",
    `\\bwhat'?s in my (?:${ACCOUNT_WORDS}|investments?)\\b`,
    `\\bhow much (?:do i have |is there |money is |is |have i got )?(?:in|on) (?:my )?(?:${ACCOUNT_WORDS}|investments?)\\b`,
    `\\bhow (?:much|big) is my (?:${ACCOUNT_WORDS})\\b`,
    "^(?:investments|holdings|portfolio|my 401\\(?k\\)?)$",
  ].join("|"),
);

// Spec step 129: the investor profile.
const PROFILE =
  /\b(?:my )?(?:risk (?:profile|tolerance|level)|investor profile|investing profile)\b|\bhow much risk (?:should|can|do) i\b|\b(?:change|update|redo|set) (?:my )?(?:investing|investment|investor) (?:goals?|profile|answers)\b|\b(?:change|update|redo) my risk\b|\banswer (?:the |your )?(?:profile |investing )?questions\b|\bwhat (?:are|is) my (?:investing|investment) goals?\b/;

// Spec step 130: what investing costs. Only with an investing word, so "bank fees" and
// "lower my fees" stay where they were.
const FEES =
  /\bexpense ratios?\b|\b(?:investment|investing|fund|401\(?k\)?|ira|brokerage|portfolio|advisory|adviser|advisor) (?:fees?|costs?|charges?)\b|\bwhat do (?:my )?(?:investments|funds|401\(?k\)?) cost\b|\bhow much (?:do|am) i pay(?:ing)? (?:in fees )?(?:for|on) (?:my )?(?:investments|funds|401\(?k\)?|ira|brokerage)\b|\bcheaper funds?\b|\blower[- ]cost funds?\b/;

export function parseInvestmentIntent(text: string): InvestmentIntent | null {
  if (FEES.test(text)) {
    return { kind: "investments", topic: "fees", account: ACCOUNT.exec(text)?.[1] ?? null };
  }
  if (PROFILE.test(text)) return { kind: "investments", topic: "profile", account: null };
  if (!HOLDINGS.test(text)) return null;
  const account = ACCOUNT.exec(text)?.[1] ?? null;
  return {
    kind: "investments",
    topic: "holdings",
    account: account && !/^(?:portfolio|investment account)$/.test(account) ? account : null,
  };
}
