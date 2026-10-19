// Questions about investments, understood by rules (spec step 128 on). Pure: the
// normalized text in (./../intents.ts normalize), the topic out, or null when it isn't
// about investments. Each investment step adds its topics here.

export type InvestmentTopic = "holdings" | "profile" | "fees" | "review" | "retirement";

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

// Spec step 131: does it fit?
const REVIEW =
  /\b(?:review|check|look at|assess) (?:my )?(?:portfolio|investments|401\(?k\)?|ira|allocation|holdings)\b|\b(?:is|are) my (?:portfolio|investments|401\(?k\)?|ira|mix) (?:ok|okay|good|fine|balanced|right|too risky|risky|diversified)\b|\bam i (?:well |properly )?diversified\b|\b(?:asset )?allocation\b|\bhow should i (?:invest|be invested)\b|\bwhat should i (?:change|do) (?:with|in|about) my (?:portfolio|investments|401\(?k\)?|ira|brokerage)\b|\bportfolio review\b|\btoo much (?:in|of) (?:one|a single) (?:stock|company)\b/;

// Spec step 132: on track for retirement?
const RETIREMENT =
  /\bretire(?:ment)?\b(?! account)|\b(?:401\(?k\)?|employer) match\b|\bmatch(?:ing)? (?:on|in|from) my 401\(?k\)?\b|\broth (?:or|vs\.?|versus) traditional\b|\btraditional (?:or|vs\.?|versus) roth\b|\bcatch[- ]up contributions?\b|\bhow much should i (?:put|contribute|save) (?:in|into|to) my (?:401\(?k\)?|ira)\b|\bnest egg\b/;

export function parseInvestmentIntent(text: string): InvestmentIntent | null {
  if (RETIREMENT.test(text)) return { kind: "investments", topic: "retirement", account: null };
  if (REVIEW.test(text)) return { kind: "investments", topic: "review", account: null };
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
