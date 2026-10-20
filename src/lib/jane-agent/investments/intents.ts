// Questions about investments, understood by rules (spec step 128 on). Pure: the
// normalized text in (./../intents.ts normalize), the topic out, or null when it isn't
// about investments. Each investment step adds its topics here.

export type InvestmentTopic =
  | "holdings"
  | "profile"
  | "fees"
  | "review"
  | "retirement"
  | "rebalance"
  | "auto_invest"
  | "accounts"
  | "overview"
  | "autopilot"
  | "returns"
  | "goals"
  | "college"
  | "hsa"
  | "company_stock"
  | "crypto"
  | "cash"
  | "steady"
  | "retirement_accounts"
  | "old_accounts"
  | "retirement_income"
  | "family"
  | "property";

export type InvestmentIntent = {
  kind: "investments";
  topic: InvestmentTopic;
  // The account the person named ("401k", "brokerage", "ira"), when they named one.
  account: string | null;
  // Spec step 158: a child's age and the kind of college, when the person said them.
  childAge?: number;
  collegeType?: "public" | "private";
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
  /\bexpense ratios?\b|\b(?:investment|investing|fund|401\(?k\)?|ira|brokerage|portfolio|advisory|adviser|advisor) (?:fees?|costs?|charges?)\b|\bwhat do (?:my )?(?:investments|funds|401\(?k\)?) cost\b|\bhow much (?:do|am) i pay(?:ing)? (?:in fees )?(?:for|on) (?:my )?(?:investments|funds|401\(?k\)?|ira|brokerage)\b|\b(?:fees?|costs?|charges?)\b[^.?!]* (?:on|for|in) (?:my )?(?:investments|funds|401\(?k\)?|ira|brokerage|portfolio)\b|\bcheaper funds?\b|\blower[- ]cost funds?\b/;

// Spec step 131: does it fit?
const REVIEW =
  /\b(?:review|check|look at|assess) (?:my )?(?:portfolio|investments|401\(?k\)?|ira|allocation|holdings)\b|\b(?:is|are) my (?:portfolio|investments|401\(?k\)?|ira|mix) (?:ok|okay|good|fine|balanced|right|too risky|risky|diversified)\b|\bam i (?:well |properly )?diversified\b|\b(?:asset )?allocation\b|\bhow should i (?:invest|be invested)\b|\bwhat should i (?:change|do) (?:with|in|about) my (?:portfolio|investments|401\(?k\)?|ira|brokerage)\b|\bportfolio review\b|\btoo much (?:in|of) (?:one|a single) (?:stock|company)\b/;

// Spec step 132: on track for retirement?
const RETIREMENT =
  /\bretire(?:ment)?\b(?! account)|\b(?:401\(?k\)?|employer) match\b|\bmatch(?:ing)? (?:on|in|from) my 401\(?k\)?\b|\broth (?:or|vs\.?|versus) traditional\b|\btraditional (?:or|vs\.?|versus) roth\b|\bcatch[- ]up contributions?\b|\bhow much should i (?:put|contribute|save) (?:in|into|to) my (?:401\(?k\)?|ira)\b|\bnest egg\b/;

// Spec step 133: move to the recommended mix.
const REBALANCE =
  /\brebalanc\w*\b|\b(?:move|get) (?:me |my (?:money|investments) )?(?:to|back to) (?:the |my )?(?:recommended|target|right) mix\b|\bfix my (?:mix|portfolio|allocation)\b/;

// Spec step 134: investing automatically.
const AUTO_INVEST =
  /\b(?:auto[- ]?invest\w*|automatic(?:ally)? invest\w*|invest\w* automatically)\b|\binvest (?:every|each|on) (?:payday|paycheck|month)\b|\b(?:pause|stop|resume|restart) (?:my )?(?:auto(?:matic)? )?investing\b/;

// Spec step 135: which account first, where to hold what, gains not yet taxed.
const ACCOUNTS =
  /\bwhich account (?:should i |do i |to )?(?:invest|put|save|fill|use|start)\w*\b|\bwhere should i (?:put|invest|save|keep) (?:my )?(?:extra |spare |the )?money\b|\b(?:401\(?k\)?|workplace plan) or (?:a )?(?:roth )?ira\b|\b(?:roth )?ira or (?:a |my )?401\(?k\)?\b|\bshould i (?:open|get|start|use) (?:a |an )?(?:roth |traditional )?(?:ira|hsa)\b|\b(?:contribute to|fund|max out) (?:my |an |a )?hsa\b|\basset location\b|\b(?:capital|unreali[sz]ed) (?:gains?|losses?)\b|\btax[- ]loss harvest\w*\b|\btaxes on my investments\b/;

// Spec step 137: how it's going, and what Jane does by herself.
const OVERVIEW =
  /\bhow(?:'s| are| is| have) my (?:investments|portfolio|401\(?k\)?|brokerage|ira)(?: been)? (?:doing|going|looking)\b|\b(?:investment|portfolio|investing) (?:update|summary|note|check-?in)\b|\bmonthly (?:investment|portfolio) note\b/;
const AUTOPILOT =
  /\bwhat do you do (?:with|about|for) my (?:investments|portfolio|money in the market)\b|\b(?:investments?|investing|portfolio) on autopilot\b|\bautopilot (?:for|on) (?:my )?(?:investments|investing|portfolio)\b|\bwhat (?:will|would|do) you (?:do|change) (?:in|with) my (?:investments|portfolio) (?:by yourself|on your own)\b/;

// Spec step 156: how they've done, in numbers.
const RETURNS =
  /\b(?:my |the )?(?:investment |portfolio |401\(?k\)? )?(?:returns?|performance)\b(?! policy)|\bhow much (?:have|did) my (?:investments|portfolio|401\(?k\)?) (?:make|made|earn|earned|grow|grown|gain|gained)\b|\bhow much (?:have|did) i (?:make|made|earn|earned) (?:on|from) my (?:investments|portfolio)\b/;

// Spec step 157: each goal's money, invested for when it's needed.
const GOALS_INVESTED =
  /\bglide path\b|\bgoal buckets?\b|\b(?:invest|investing) (?:for|by) (?:my |each )?goals?\b|\bhow (?:is|should) (?:my )?(?:\w+ )?goal (?:be )?invested\b|\bshould i invest (?:my |the )?(?:\w+ )?(?:fund|savings|money) for (?:a |my |the )?(?:house|home|car|wedding|trip|down payment)\b/;

// Spec step 158: saving for a child's college.
const COLLEGE = /\b(?:college|529|university|tuition)\b/;
const CHILD_AGE =
  /\b(\d{1,2})[- ]?(?:year[- ]?olds?|yr[- ]?olds?|yo|years? old)\b|\b(?:is|turns|aged?) (\d{1,2})\b/;

// Spec step 159: the HSA.
const HSA =
  /\bhsa\b|\bhealth savings account\b|\b(?:medical )?receipts? vault\b|\bmedical receipts?\b/;

// Spec step 160: stock from where the person works.
const COMPANY_STOCK =
  /\brsus?\b|\bespp\b|\bstock options?\b|\b(?:company|employer|employer's|company's) (?:stock|shares)\b|\b(?:restricted stock|stock plan|equity grants?|vesting schedule|vested shares|unvested shares)\b/;

// Spec step 161: crypto.
const CRYPTO =
  /\b(?:crypto(?:currency|currencies)?|bitcoin|btc|ether(?:eum)?|eth|solana|coinbase|crypto wallet|stablecoins?|usdc)\b/;

// Spec step 162: where cash should sit.
const CASH =
  /\bhigh[- ]yield savings\b|\bmoney market\b|\btreasur(?:y|ies) (?:ladder|bills?)\b|\bt[- ]?bills?\b|\bwhere should i (?:keep|put|park) (?:my )?(?:cash|savings|emergency fund)\b|\b(?:is|are) my (?:cash|savings) earning\b|\bcash (?:earning|interest|done right)\b/;

// Spec step 163: worry in a drop, and wanting to sell because of it.
const STEADY =
  /\bshould i sell (?:everything|all|my (?:stocks|investments|funds|portfolio))\b|\b(?:market|stocks?|portfolio|investments?) (?:is |are )?(?:crash\w*|tank\w*|plung\w*|down a lot|dropping|falling)\b|\bwhy (?:are|is) my (?:investments?|portfolio|stocks) down\b|\bpanic\b.*\b(?:sell|invest)\w*|\bget out of the market\b|\bsell (?:everything|it all) now\b/;

// Spec step 210: limits, the match, Roth or traditional, the backdoor Roth.
const RETIREMENT_ACCOUNTS =
  /\bbackdoor roth\b|\b(?:contribution|contribute) limits?\b|\bhow much can i (?:put|contribute|save) (?:in|into|to) (?:my |an? )?(?:401\(?k\)?|403\(?b\)?|ira|roth|retirement)\b|\b(?:am i|are we) (?:getting|getting all of|missing) (?:the |my )?(?:full |whole )?(?:employer )?match\b|\bmax(?:ing)? out my (?:401\(?k\)?|ira|roth)\b/;

// Spec step 211: forgotten 401(k)s and rollovers.
const OLD_ACCOUNTS =
  /\b(?:old|previous|prior|past|former|forgotten|lost) (?:401\(?k\)?|403\(?b\)?|retirement (?:plan|account)|employer plan)\b|\b401\(?k\)? (?:from|at) (?:a |my |an )?(?:old|previous|prior|past|former)\b|\broll(?:ing)? ?over\b|\brollover\b|\bleft (?:a |my )?401\(?k\)? (?:at|with)\b/;

// Spec step 212: Social Security, minimum distributions and the retirement paycheck.
const RETIREMENT_INCOME =
  /\bsocial security\b|\brmds?\b|\brequired minimum distributions?\b|\bretirement (?:paycheck|income)\b|\bwhen (?:should|can) i (?:claim|take|start)\b.*\b(?:social security|benefits?)\b|\bhow long will my (?:money|savings|retirement) last\b|\bwhich accounts? (?:do i |should i )?(?:draw|withdraw|take) (?:from )?first\b|\bdrawdown\b/;

// Spec step 213: children's accounts and gifts to a child's college fund.
const FAMILY =
  /\bcustodial (?:account|ira|roth)\b|\butma\b|\bugma\b|\b(?:roth ira|roth|investing|account) for (?:my |a )?(?:kid|child|teen|teenager|son|daughter)s?\b|\bgrandparents?\b.*\b(?:gift|give|contribute|529)\b|\bgift(?:s|ing)? (?:to|into) (?:a |my |the )?(?:529|college fund)\b|\bkiddie tax\b|\binvest(?:ing)? for (?:my )?(?:kids?|children|family)\b/;

// Spec step 214: home equity, rentals and paying the mortgage down against investing.
const PROPERTY =
  /\binvestment propert(?:y|ies)\b|\bmy rental\b|\bhome equity\b|\b(?:pay|paying) (?:off |down )?(?:my |the )?mortgage (?:early |down |off )?(?:or|vs\.?|versus|instead of) invest|\b(?:should i )?(?:pay|paying) (?:down |off )?(?:my |the )?mortgage (?:faster|early)\b|\bpay(?:ing)? extra (?:on|toward|towards) (?:my |the )?mortgage\b|\bcash on cash\b|\blandlord\b/;

export function parseInvestmentIntent(text: string): InvestmentIntent | null {
  if (PROPERTY.test(text)) return { kind: "investments", topic: "property", account: null };
  if (FAMILY.test(text)) return { kind: "investments", topic: "family", account: null };
  if (RETIREMENT_INCOME.test(text))
    return { kind: "investments", topic: "retirement_income", account: null };
  if (OLD_ACCOUNTS.test(text)) return { kind: "investments", topic: "old_accounts", account: null };
  if (RETIREMENT_ACCOUNTS.test(text))
    return { kind: "investments", topic: "retirement_accounts", account: null };
  if (STEADY.test(text)) return { kind: "investments", topic: "steady", account: null };
  if (CASH.test(text)) return { kind: "investments", topic: "cash", account: null };
  if (CRYPTO.test(text)) return { kind: "investments", topic: "crypto", account: null };
  if (COMPANY_STOCK.test(text))
    return { kind: "investments", topic: "company_stock", account: null };
  if (HSA.test(text) && !/\bshould i (?:open|get|start|use|max out|fund|contribute)\b/.test(text)) {
    return { kind: "investments", topic: "hsa", account: null };
  }
  if (COLLEGE.test(text) && !/\bcollege (?:loan|debt)s?\b|\bstudent loan/.test(text)) {
    const age = CHILD_AGE.exec(text);
    const years = age ? Number(age[1] ?? age[2]) : NaN;
    return {
      kind: "investments",
      topic: "college",
      account: null,
      ...(Number.isInteger(years) && years <= 17 ? { childAge: years } : {}),
      ...(/\bprivate\b/.test(text)
        ? { collegeType: "private" as const }
        : /\b(?:public|state|in-state)\b/.test(text)
          ? { collegeType: "public" as const }
          : {}),
    };
  }
  if (GOALS_INVESTED.test(text)) return { kind: "investments", topic: "goals", account: null };
  if (RETURNS.test(text) && /\b(?:invest|portfolio|401|return|performance)/.test(text)) {
    return { kind: "investments", topic: "returns", account: null };
  }
  if (AUTOPILOT.test(text)) return { kind: "investments", topic: "autopilot", account: null };
  if (OVERVIEW.test(text)) return { kind: "investments", topic: "overview", account: null };
  if (ACCOUNTS.test(text)) return { kind: "investments", topic: "accounts", account: null };
  if (AUTO_INVEST.test(text)) return { kind: "investments", topic: "auto_invest", account: null };
  if (REBALANCE.test(text)) return { kind: "investments", topic: "rebalance", account: null };
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
