import { APPROVED_DEBT_SENTENCES } from "@/config/debt-trouble";
import { APPROVED_FAMILY_SENTENCES } from "@/config/family-file";
import { APPROVED_ESTATE_SENTENCES } from "@/config/inheritance";
import { INSURER_KINDS } from "@/config/found-policies";
import { RESHOP_BANNED_PHRASES } from "@/config/insurance";
import type { FindingType } from "@/generated/prisma/client";

// Every piece of Claude-written text passes through checkGuardrails before anyone sees it.
// Anything that fails is replaced with fixed template text, so these checks lean strict:
// a false alarm only costs a plainer explanation.

export type GuardrailIssue =
  | "investment_advice"
  | "tax_or_legal_advice"
  | "unsupported_dollar_figure"
  | "guaranteed_outcome"
  | "missing_required_wording"
  | "untrusted_link"
  | "credential_request"
  | "claimed_action"
  | "deposit_insurance"
  | "insurance_comparison";

export type GuardrailResult = { ok: true } | { ok: false; issues: GuardrailIssue[] };

// (a) Specific securities, investments or crypto. High-yield savings accounts and CDs are
// bank deposits, not investments, so they're allowed.
// Everyday words that share a spelling stay allowed (11-01: chat answers were blocked for them):
// a bank that will "investigate", "in stock", someone who "shares the plan", "home equity", a
// "bail bond" or "Bond Street Coffee", a "Treasury offset" or refund, and "Ira" the person.

// A pick of what to own, however it's put (11-04: "I'd buy Apple over Microsoft", "Get into VTI
// now"). A ticker is capitals, and these capitals aren't tickers: banks, insurers, plans, agencies
// and shops people do choose between. "Go with GEICO" or "Pick an HMO" is about something else.
const NOT_TICKERS =
  "(?!(?:CDS?|HYSA|FDIC|USAA|PNC|ACH|APY|APR|BMO|HSBC|USD|PMI|HSA|FSA|ATM|IRS|SSA|CFPB|FTC|DMV|BBB|FHA|HUD|USDA|AAA|AARP|AMEX|VISA|GEICO|FICO|HELOC|ARM|PPO|HMO|EPO|HDHP|COBRA|CVS|UPS|USPS|BMW|HBO|ESPN|IKEA|KFC|NBA|NFL|NYC|USA|LLC|HVAC)\\b)";
// Companies people own shares of, and not shops whose name is also where the groceries come from:
// "Costco is a better buy than Safeway" is shopping.
const COMPANY =
  "(?:Apple|Microsoft|Tesla|Nvidia|Alphabet|Meta|Palantir|Berkshire|Coinbase|Robinhood|Vanguard|Fidelity|Schwab|Boeing|Intel|Ford)";
const END_OF_PICK =
  "(?=[ \\t]*\\n|\\s*(?:now|today|this (?:week|month|year)|before\\b|and hold\\b|for (?:the long term|this)\\b|over\\b|[.!?,;]|$))";
const OWN_IT =
  "[Gg]et (?:into|out of)|[Gg]o (?:with|long(?: on)?|short(?: on)?)|[Pp]ick(?: up)?(?: some| more)?|[Cc]hoose|[Gg]rab(?: some| more)?|[Ll]oad up on|[Pp]ile into|[Bb]uy into|[Ss]tart with|[Ss]tick (?:with|to)|[Ss]tay in|[Cc]ash out of|[Bb]et on|[Ff]avou?r|[Hh]old|[Oo]wn(?: more)?|[Tt]rim|[Dd]ump|[Aa]dd to";
const STOCK_PICKS = [
  // "Get into VTI now", "Pick up some AAPL".
  new RegExp(`\\b(?:${OWN_IT})\\s+${NOT_TICKERS}[A-Z]{3,5}\\b(?![&-])`),
  // "Get into Apple now", "Grab some Nvidia": these verbs reach shops too, so only for a company.
  new RegExp(`\\b(?:${OWN_IT})\\s+${COMPANY}\\b${END_OF_PICK}`),
  // "Pile into Snowflake", "Go long Tesla": nobody says these of a shop, so any name.
  /\b(?:[Pp]ile into|[Bb]uy into|[Gg]o (?:long|short)(?: on)?|[Bb]et on|[Ll]oad up on)\s+[A-Z][a-z]+\b(?=\s*(?:now|today|this (?:week|month|year)|[.!?,;]|$))/,
  // "I'd buy Apple over Microsoft": one name against another, with nothing bought between them.
  /\b(?:[Bb]uy|[Ss]ell)(?:ing)?\s+(?:some |more )?[A-Z][a-z]+\s+(?:over|instead of|rather than|versus|vs\.?)\s+[A-Z][a-z]+\b(?=\s*(?:[.!?,;]|$))/,
  // "VTI is the better pick", "Apple is a better buy than Microsoft", "Tesla looks like a buy".
  new RegExp(
    `\\b(?:${NOT_TICKERS}[A-Z]{3,5}|${COMPANY})(?:\\s+(?:is|looks|seems|would be|could be|might be|makes)|(?:'|’)s)(?: like)?(?: an?| the)?(?: (?:good|better|best|great|strong|stronger|strongest|smart|smarter|safe|safer|safest|solid|top|clear))?\\s+(?:buy|pick|bet|choice|play|hold|sell|move)\\b`,
  ),
  // "My top pick is Apple", "The safer bet is VOO" (chat policy round 10, 11-12).
  new RegExp(
    `\\b(?:pick|choice|favou?rite|bet|buy|play) (?:is|would be)\\s+(?:${NOT_TICKERS}[A-Z]{3,5}\\b(?![&-])|${COMPANY}\\b${END_OF_PICK})`,
  ),
  // A verdict after a dash or a colon, and a pick shouted (chat policy round 12, 11-12): "Tesla — sell",
  // "SELL TESLA NOW". "Buy now, pay later" is a kind of plan. Round 13 (11-12): "Tesla → sell",
  // "Apple: strong buy", "Tesla's a hold for now", "NVDA is the move", "📈 TSLA 🚀".
  new RegExp(
    `\\b(?:${NOT_TICKERS}[A-Z]{3,5}|${COMPANY})\\s*(?:[—–:-]+|→|=>|⇒|->)\\s*(?:(?:[Ss]trong|[Cc]lear|[Ee]asy|[Ss]olid) )?(?:[Bb]uy|[Ss]ell|[Hh]old|[Dd]ump|[Tt]rim|[Ss]hort)\\b`,
  ),
  /\b(?:BUY|SELL|SHORT|DUMP)\s+(?!(?:NOW|PAY|IT|THE|A|AN|ONE|MORE|LESS)\b)[A-Z]{3,}\b/,
  /\$?\b[A-Z]{3,5}\s*(?:🚀|📈|💎|🌕)|(?:🚀|📈|💎)\s*\$?[A-Z]{3,5}\b/u,
  // "Tesla is overvalued". Of a home or a car it says nothing about a share.
  new RegExp(
    `\\b(?:${NOT_TICKERS}[A-Z]{3,5}|${COMPANY})\\s+(?:is|looks|seems)\\s+(?:\\w+\\s+)?(?:over|under)valued\\b`,
  ),
];

const INVESTMENT = [
  /\binvest(?!igat)/i,
  /(?<!\b(?:in|of) )\bstocks?\b(?! up\b)/i,
  /\bshares\b(?!\s+(?:the|your|my|a|an|this|that|their|his|her|its|it|with)\b)/i,
  /(?<!\bhome )\bequit(y|ies)\b(?! (?:line|loan)s?\b)(?! in (?:your|the|my|their) (?:home|house|condo|car)\b)/i,
  /(?<!\b(?:bail|surety|security|performance|fidelity) )\bbonds?\b(?! (?:street|st)\b)/i,
  /\bsecurities\b/i,
  /\betfs?\b/i,
  /\b(index|mutual|money[- ]market|hedge) funds?\b/i,
  /\btreasur(y|ies)\b(?! (?:offset|refund|check|department|tax)s?\b)/i,
  /\bt-bills?\b/i,
  /\bbrokerage\b/i,
  /\bportfolio/i,
  /\bdividends?\b/i,
  /\bcrypto/i,
  /\b(bitcoin|ethereum|btc|eth|solana|dogecoin|stablecoins?)\b/i,
  // Chat policy round 10 (11-12): "Stack some sats every payday", "Buy puts on Tesla before
  // earnings", "Gold is a good hedge right now; get some". Gold's Gym and a Gold card are bills.
  /\bstack(?:ing)? (?:some |more |a few )?sats\b|\bsatoshis?\b/i,
  /\b(?:buy|buying|sell|selling|write|writing|short|shorting) (?:some |a few |the )?(?:covered |naked |cash[- ]secured |long |short )?(?:puts?|calls?|call options?|put options?|straddles?|strangles?|leaps)\b/i,
  /\b(?:gold|silver|bullion|precious metals|commodities)\b(?!(?:'|’)s)[^.!?]{0,20}\b(?:is|are|makes?) (?:a |an )?(?:good |great |solid |smart |safe |safer |better )?(?:hedge|buy|investment|store of value|bet)\b/i,
  /\b(?:buy|buying|get|own|add|grab|put (?:some|money|it|\$[\d,.]+) (?:in|into))\b[^.!?]{0,25}(?:\bgold\b(?!(?:'|’)s| (?:card|member|plan|tier|status|level|package|gym|rewards))|\b(?:bullion|precious metals)\b)/i,
  /\b(nyse|nasdaq|s&p ?500|dow jones|ticker)\b/i,
  /\b401\(?k\)?/i,
  // An IRA is written in capitals; "Ira" is a person.
  /\broth\b/i,
  /\bIRAs?\b/,
  /\b(?:traditional|rollover|sep|simple|inherited|spousal) iras?\b/i,
  /\b(?:an|your|their|my) iras?\b/i,
  /\bannuit(y|ies)\b/i,
  // What to buy, sell or hold, and how investments did (spec step 66: balances only).
  // A bank "holding the funds" from a deposit is a hold, not a holding.
  /\b(buy|buying|sell|selling|dump|trim|trimm(?:ing|ed))\b(?:[^.!?]|\.\d){0,40}\b(positions?|holdings?|funds?|shares?|stocks?|assets?|stakes?(?! in (?:the|your|a|my|their) (?:car|house|home|condo|boat|truck)\b))\b/i,
  /\b(hold|holding)\b(?:[^.!?]|\.\d){0,40}\b(positions?|holdings?|shares?|stocks?)\b/i,
  // A bare ticker (11-03): "Buy NVDA", "$NVDA", "put it into TSLA". Written in capitals, so "buy a TV"
  // and the things in capitals people do buy aren't one.
  /\b(?:[Bb]uy|[Ss]ell|[Ss]hort|[Dd]ump)(?:ing)?\s+(?:some |more |a lot of )?(?!(?:TVs?|PCs?|CDs?|USB|AAA|IKEA|GPS|HD|DVDs?|EVs?|SUVs?)\b)[A-Z]{2,5}\b/,
  /\b(?:[Pp]ut(?:ting)?|[Mm]ov(?:e|ing))\b(?:[^.!?]|\.\d){0,40}\binto (?!(?:CDs?|HYSA|FDIC)\b)[A-Z]{2,5}\b/,
  /\$[A-Z]{1,5}\b/,
  // The best-known funds' tickers written small (chat policy round 12, 11-12): "Buy voo now", "Put it
  // in vti". In capitals the rules above judge them, so a simulated strategy's own rule ("buy $500
  // of VTI") still passes.
  /\b(?:[Vv](?:oo|ti|tsax|fiax|xus|btlx|gt)|[Ff](?:xaix|zrox)|[Ss](?:wppx|chd|qqq)|[Qq]qq|[Tt]qqq|[Aa]rkk|[Bb]nd)\b/,
  // Round 13 (11-12): a stock written small ("Dump your tsla"), a mutual fund in capitals ("I'd go
  // with FXAIX": four letters and an X; a watch, a shipper or a word isn't one), "HODL", and the
  // employer match ("Take the match, it's free money").
  /\b(?:[Tt]sla|[Nn]vda|[Aa]apl|[Mm]sft|[Aa]mzn|[Gg]oogl?|[Pp]ltr)\b/,
  /\b(?!(?:ROLEX|FEDEX|TIMEX|LATEX|XEROX|PYREX|DUREX|CODEX|INDEX|RELAX|ANNEX|SPANX|UNISEX|DUPLEX|COMPLEX)\b)[A-Z]{4}X\b/,
  /\bhodl(?:ing)?\b/i,
  /\b(?:take|get|grab|capture|claim|max(?:imi[sz]e)?|don(?:'|’)t (?:miss|leave|skip|lose))\b[^.!?]{0,25}\b(?:employer(?:'|’)?s?|company(?:'|’)?s?|full|401\(?k\)?) match\b|\bmatch\b[^.!?]{0,20}\bfree money\b|\bfree money\b[^.!?]{0,20}\bmatch\b/i,
  // A company by name and nothing after it (11-04): "You should buy Tesla now". "Buy Costco gas"
  // has a thing after the name, and it's the thing being bought.
  // "Buy Now, Pay Later" is a kind of plan.
  /\b(?:[Bb]uy|[Ss]ell|[Ss]hort)(?:ing)?\s+(?:some |more )?(?!Now\b)[A-Z][a-z]+\b(?=[ \t]*\n|\s*(?:now|today|this week|before\b|and hold\b|[.!?,]|$))/,
  // A bare ticker after "in" or "to" (11-04): "Put the extra in VOO", "Move your savings to VOO". A
  // bank's or a card's own letters, or more words after the letters ("in PNC savings"), aren't one.
  // Nor is what someone did or might do: "You put $400.00 on your card for the trip in CA".
  /(?<!\b(?:[Yy]ou|[Ww]e|I|[Tt]hey)\s)\b(?:[Pp]ut|[Mm]ove)\b(?:[^.!?]|\.\d){0,40}\b(?:in|your \w+ to|it to) (?!(?:CDs?|HYSA|FDIC|USAA|PNC|ACH|APY|APR|TD|BMO|HSBC|SoFi|USD)\b)[A-Z]{2,5}\b(?=\s*(?:now|today|and [A-Z]{2,5}\b|for\b|each\b|every\b|[.!?,]|$))/,
  // Filling an HSA, FSA or 529 as the move (11-04). Naming one, or what's in it, stays a fact.
  /(?:^|[.!?:;]\s+|\byou should\s+|\bi(?:'|’)?d\s+)(?:max(?:ing)? (?:out|your)|maximi[sz]e|fill(?: up)?|put the max in(?:to)?|contribut(?:e|ing)(?: more| the max)? to|fund(?!:))\b[^.!?]{0,30}\b(?:hsa|fsa|529)\b/i,
  // Retirement and other investment moves as the move (aup-audit 11-06, Anthropic's Usage Policy
  // from Nov 12, 2026): "Put the bonus in your HSA", "Use a 529 plan", "Put 10% of your pay into
  // retirement", "Take Social Security at 70", "Exercise your options now", "Harvest the loss",
  // "Pick the target-date fund" got through. What someone did ("You put $400 into your HSA") and
  // what's there ("Your pension pays $1,200") stay facts.
  /(?:^|[.!?:;]\s+|\byou should\s+|\bi(?:'|’)?d\s+)(?:put|move|add|contribut(?:e|ing)|deposit|open|start|set up)\b[^.!?]{0,40}\b(?:hsa|529)\b/i,
  /\buse an? 529\b/i,
  /(?:^|[.!?:;]\s+|\byou should\s+|\bi(?:'|’)?d\s+)(?:put|save|set aside|move|contribut(?:e|ing)|add|send)\b[^.!?]{0,40}\b(?:into|in|to|toward|for) (?:your |a )?retirement\b/i,
  /(?:^|[.!?:;]\s+|\byou should\s+|\bi(?:'|’)?d\s+)(?:take|claim|start|begin|delay|wait)\b[^.!?]{0,30}\b(?:social security|pension)\b/i,
  /\bexercis(?:e|ing) (?:your |the |those |some |all )?(?:vested |incentive )?(?:stock )?options\b/i,
  /\b(?:sell|hold|keep|dump)\w*\b[^.!?]{0,30}\b(?:rsus?|espp)\b/i,
  /\btax[- ]loss harvest/i,
  /\bharvest(?:ing)? (?:the |a |your |some |those )?(?:loss|losses|gains?)\b/i,
  /\btarget[- ]date\b/i,
  /(?:^|[.!?:;]\s+|\byou should\s+|\bi(?:'|’)?d\s+)(?:take|withdraw|skip|delay)\b[^.!?]{0,30}\b(?:rmds?|required minimum distributions?)\b/i,
  // The same moves said another way (security round 48): "Hold off on Social Security until 70",
  // "Don't take Social Security yet", "Your best move is to claim Social Security at 67", "Wait
  // until 70 to claim your benefits", "Exercise your ISOs". "You started Social Security at 62" and
  // "If you wait until 70, ..." (how the rule works) stay facts.
  /\b(?:hold(?:ing)? off|don(?:'|’)?t (?:take|claim|start)|do not (?:take|claim|start)|(?:best|smart|right|better) (?:move|bet|choice|option|plan) (?:is|would be) to (?:take|claim|start|delay|wait))\b[^.!?]{0,30}\b(?:social security|pension)\b/i,
  /(?<!\bif (?:you|they) )\b(?:wait|hold off|delay)\w*\b[^.!?]{0,20}\b(?:until|till|to) (?:age )?(?:6[2-9]|70)\b[^.!?]{0,30}\b(?:claim|take|start|collect|benefits|social security|pension)\b/i,
  /\bexercis(?:e|ing)\b[^.!?]{0,20}\b(?:isos?|nsos?)\b/i,
  // Other words for the same moves (chat policy round 2, 11-06): "Now is a good time to buy", "Dollar-cost
  // average $200 a month into VOO", "Pick the growth fund over the value fund", "Sell the losers
  // before December 31 to offset the gains". A good time to buy a car is shopping: only "now".
  /\b(?:now|today|this (?:week|month)) (?:is|looks like|seems like) (?:a |the )?(?:good|great|bad|right|wrong|smart|perfect|best|ideal) time to (?:buy|sell|get in|get out|cash out)\b(?=\s*(?:in|more|back|[.!?,;]|$))/i,
  /\b(?:buy the dip|time the market|(?:get|stay|be) (?:back )?(?:in(?:to)?|out of) the (?:stock )?market)\b/i,
  /\bdollar[- ]cost averag/i,
  // A judgment rather than an instruction (chat policy round 9, 11-12): "Holding makes more sense
  // than selling", "Selling now would lock in your loss, so wait", "Traditional wins for you".
  /\b(?:holding|keeping) (?:on |it |them )?makes (?:more )?sense\b|\b(?:holding|selling|buying|keeping)\b[^.!?]{0,30}\bthan (?:selling|holding|buying|keeping)\b/i,
  /\block in (?:your |the |a |any )?(?:loss|losses|gains?|profits?)\b/i,
  /\btraditional (?:wins|is (?:the )?better|comes out ahead|makes more sense|fits you)\b/i,
  /\b(?:growth|value|balanced|total[- ](?:stock )?market|large[- ]cap|mid[- ]cap|small[- ]cap|emerging[- ]markets?|sector|dividend) (?:funds?|etfs?)\b/i,
  /\boffset(?:ting)? (?:the |your |some |those |any )?(?:capital )?gains?\b/i,
  /\bsell(?:ing)? (?:the |your |some |those )?(?:losers|winners)\b/i,
  // Dressed up (chat policy round 3, 11-06): "Many people in your spot move their savings into
  // the market", "Personally, I'd go all in on the S&P", "The numbers say you should hold, not
  // sell", "An 80/20 split would suit you", "You're too conservative; take on more risk", "Keep
  // buying no matter what the market does".
  /\b(?:move|put|get|stay|go|jump|pull|take)\w*\b[^.!?]{0,30}\b(?:in(?:to)?|out of) the (?:stock )?market\b/i,
  /\bs&p\b|\ball[- ]in on\b/i,
  /\b(?:hold|sell|buy),? (?:not|rather than|instead of) (?:sell|hold|buy)\b/i,
  /\b[1-9]0\/[1-9]0 (?:split|mix|portfolio|allocation)\b(?!\s+(?:of|between)\b)/i,
  /\byou(?:'|’)?re too (?:conservative|aggressive)\b|\btake on (?:more|less) risk\b/i,
  /\bwhat the market does\b/i,
  ...STOCK_PICKS,
  /\brebalanc/i,
  // "Your budget allocation" is a budget.
  /\b(?:asset|portfolio|investment|fund) allocation\b/i,
  /\b(outperform\w*|underperform\w*|beat the market|market timing|capital gains?)\b/i,
];

// (b) Tax or legal advice. Demo advice (below) allows the tax part, never the legal part.
// Tax ADVICE is telling the person what to do about their taxes (deduct, claim, write off,
// itemize, file, set aside, pay less) or how the tax rules treat their money. A figure from
// Jane's own data and tools ("Lucid Trading paid you $3,200.00", "my estimate of your federal
// tax this year is $4,210.00") is a fact, not advice: the word "tax" alone isn't blocked
// (founder 10-30: a tax question was blocked twice and the person got an unrelated answer).
const DEDUCTIONS =
  /(?<!(?:payroll|paycheck|pay) )\bdeductions?\b(?! (?:from|on|in) (?:your|my|the|their) (?:pay|paycheck|paychecks|wages)\b)/i;
const LIABLE =
  /(?<!(?:injury|damage|personal|zero) )\bliab(le|ility)\b(?! (?:cover|coverage|insurance|limits?|only)\b)(?!, per\b)(?! for (?:unauthori[sz]ed|fraudulent) (?:card |debit |credit )?(?:charges|transactions|purchases|use)\b)/i;
const TAX_WORD = /\btax(es|ed|able)?\b/i;
// The IRS named as a payee ("a $412.00 payment to the IRS") is a fact; telling the person what to
// do with it, or what it allows, is advice.
const IRS = /\birs\b/i;
const IRS_ADVICE = [
  /\b(?:ask|call|contact|check with|write to|report|declare|disclose|tell)\b[^.!?]{0,30}\bthe irs\b/i,
  /\b(?:hide|hiding|keep|keeping|shield|protect|conceal|avoid)\b[^.!?]{0,30}\bfrom the irs\b/i,
  /\b(?:the )?irs (?:allows?|lets|requires?|treats?|considers?|counts?|says|wants|expects|accepts?|will (?:see|treat|count|tax|audit|flag|accept|allow)|won(?:'|’)t)\b/i,
  // Whether the IRS would find out (chat policy round 8, 11-12: "Hypothetically, the IRS probably
  // wouldn't notice the cash tips"): a word on getting away with it, however it's hedged.
  /\b(?:the )?irs (?:\w+ )?(?:would(?:n(?:'|’)?t| not)?|won(?:'|’)?t|will(?: not)?|does(?:n(?:'|’)?t| not)|never|can(?:'|’)?t|cannot|is (?:not )?(?:likely|unlikely) to) (?:\w+ )?(?:notice|catch|find out|know|check|see|care|find)\b/i,
];
// What marks text as tax talk, for the demo advice label (isAdvice).
const TAX = [
  TAX_WORD,
  // Tax deductions. An insurance deductible is fine, so "deductible" alone is allowed, and
  // so is what comes out of a paycheck ("payroll deductions", spec step 93).
  DEDUCTIONS,
  /\bwrite[- ]off\b/i,
  /\birs\b/i,
  // Also a loan's liability and being liable, which demo advice may talk about. Liability
  // cover on an insurance policy is a kind of cover, so it's allowed (spec step 102).
  LIABLE,
];
// What is advice wherever it is said.
const TAX_ADVICE = [
  DEDUCTIONS,
  /\bwrit(?:e|es|ing|ten)[- ](?:[\w$.,']+ ){0,3}?offs?\b/i,
  ...IRS_ADVICE,
  LIABLE,
  /\btax[- ]deductible\b/i,
  // Money a company took from an account or paycheck ("Netflix deducted $15.49 from your
  // checking", "it was deducted on Oct 3") is a charge, not a tax deduction.
  /(?<!\b(?:was|were|been|be|being|is|are|get|gets|got|automatically|auto)[- ])\bdeduct(?:s|ed|ing)?\b(?! (?:\$[\d,.]+ )?(?:automatically )?(?:from|out of) (?:your|my|the|their|each|this|that) (?:\w+ )?(?:pay|paycheck|paychecks|wages|account|checking|savings|balance|card)\b)/i,
  /\bitemi[sz]\w*/i,
  /\bclaim(?:s|ed|ing)?\b[^.!?]{0,40}\b(?:deductions?|credits?|expenses?|dependents?|exemptions?|losses|home office|as a (?:business|loss|dependent))\b/i,
  /\btax[- ](?:free|break|breaks|loophole|shelter|strateg\w+|advantaged?|planning)\b/i,
  /\b(?:lower|reduce|cut|shrink|minimi[sz]e|avoid|save on|pay less)\b[^.!?]{0,40}\btax/i,
  // Filing taxes. Filing a complaint form or a return request with a store is not (11-01).
  /\b(?:file|filing|amend\w*)\b[^.!?]{0,30}\b(?:tax returns?|taxes|1040|jointly|separately)\b/i,
  /\bamend\w*\b[^.!?]{0,30}\breturns?\b/i,
  /\bfil(?:e|ing)\b (?:your|their|my|the|a joint|an amended|a federal|a state|federal|state) (?:\w+ )?returns?\b(?! (?:request|label|policy|window|shipping))/i,
  /\bschedule [a-z]\b/i,
  // What to report, and how to file: advising a person on their own taxes, which Anthropic's
  // Usage Policy (from Nov 12, 2026) holds for a qualified person's review (aup-audit 11-06:
  // "Report the Venmo money as hobby income" and "File as head of household" got through).
  /\bhobby income\b/i,
  /\b(?:report|declare|list|count|enter|record|call|treat|classify|book)\b[^.!?]{0,40}?\bas (?:hobby|business|self-employment|rental|gift|investment|capital gains?|ordinary|other|side|1099|w-?2) (?:income|earnings|money|pay)\b/i,
  /(?:^|[.!?:]\s+|\b(?:you|to|and|then|just|never|don(?:'|’)?t|do not|no need to|needn(?:'|’)?t)\s+)(?:report|declare)\b(?! (?:it|this|that|them) to (?:your|the) (?:bank|card|issuer|police|ftc|lender))[^.!?]{0,50}\b(?:income|earnings|tips|wages|gains?|winnings|side money|cash (?:pay|payments|tips))\b/i,
  /\bfil(?:e|ing) as\b/i,
  /\bhead of household\b/i,
  /\bmarried filing (?:jointly|separately)\b/i,
  /\b(?:put|enter|list|include|show|claim|report|take)\b[^.!?]{0,40}\bon your (?:\d{4} )?(?:tax |federal |state )?return\b/i,
  /\bclaim(?:ing)? (?:your|my|their|her|his|the) (?:daughter|son|kids?|children|child|parents?|mom|dad|mother|father|niece|nephew|grand\w+|girlfriend|boyfriend|partner)\b(?!['’]s)/i,
  // Changing what's withheld (aup-audit 11-06): "Increase your withholding on your W-4". What was
  // withheld stays a fact.
  /(?:^|[.!?:;]\s+|\byou should\s+|\bi(?:'|’)?d\s+)(?:increase|raise|lower|reduce|change|adjust|update|bump|boost)\b[^.!?]{0,30}\bwithholding\b/i,
  /\b(?:file|fill out|submit|give|send) (?:your employer )?a new w-?4\b/i,
  // What to put on it, and claiming a credit (chat policy round 10, 11-12): "Put 0 on line 4(c) of
  // your W-4", "Set your W-4 to single", "You qualify for the EITC, so claim it". Where the IRS's
  // estimator says what to put stays a pointer.
  /(?:^|[.!?:;]\s+|\byou should\s+|\bi(?:'|’)?d\s+)(?:put|enter|write|set|mark|claim|list|choose|select|pick|add|leave)\b[^.!?]{0,60}\bw-?4\b/i,
  /\b(?:credits?|deductions?|exemptions?)\b[^.!?]{0,40}\bclaim (?:it|them|that|this|one|both)\b/i,
  // Said another way (security round 48): "Withhold more from your paycheck", "Have your employer
  // withhold an extra $100", "Claim fewer allowances". "Your employer withholds $300" is a fact.
  /\bwithhold (?:more|less|an extra|extra|an additional|additional)\b/i,
  /\b(?:claim|put|take) (?:fewer|more|zero|0|no) allowances\b/i,
  // Other words for the same advice (chat policy round 2, 11-06): "You can skip reporting the Venmo
  // payments", "Count your nephew as a dependent", "Treat the side gig as a hobby", "Bunch your
  // donations into December", "Ask for an extension and file in October". Reporting a charge to
  // the bank is about the charge.
  /\bskip(?:ping)? (?:reporting|declaring)\b(?![^.!?]*\b(?:bank|card|issuer|police|ftc|fraud|scam)\b)/i,
  /\b(?:count|list|claim|put|add|name|include|treat)\b[^.!?]{0,30}\bas (?:a |your |their )?dependents?\b/i,
  /\b(?:treat|count|classify|call|report|file)\b[^.!?]{0,30}\bas (?:a )?hobby\b/i,
  /\bbunch(?:ing)?\b[^.!?]{0,20}\b(?:donations?|gifts|giving|deductions|contributions)\b/i,
  /\b(?:tax|irs|filing) extension\b|\bextension and file\b|\bfile for an extension\b|\bfile (?:it |your return )?(?:in|by) october\b/i,
  // Dressed up (chat policy round 3, 11-06): "Keep it off your return", "You'd probably owe less
  // if you filed separately", "Don't pay the quarterly estimate; just pay in April".
  /\b(?:keep|leave)\b[^.!?]{0,20}\boff (?:your|the) (?:tax )?return\b/i,
  /\bif you fil(?:e|ed) (?:jointly|separately|as)\b/i,
  /\b(?:skip|don(?:'|’)?t pay|do not pay|hold off on)\b[^.!?]{0,20}\b(?:quarterly|estimated) (?:estimates?|payments?|tax(?:es)?)\b/i,
  // The new tax forms and state estimates (chat policy round 4, 11-06): "Skip the state estimate
  // this time", "You don't need to report the 1099-K", "Leave the W-2 off". What a form shows
  // ("Your 1099-NEC shows $8,000.00") stays a fact.
  /\b(?:skip|don(?:'|’)?t pay|do not pay|hold off on)\b[^.!?]{0,20}\bstate (?:estimates?|estimated (?:payments?|tax(?:es)?)|tax payments?)\b/i,
  /\b(?:don(?:'|’)?t|do not|no) (?:need to|have to)\s+(?:report|declare|include|list|file)\b[^.!?]{0,30}\b(?:1099|w-?2|k-?1)\b|\b(?:skip|leave out|leave off|ignore|never report)\b[^.!?]{0,20}\b(?:the |your |that |this )?(?:1099|w-?2|k-?1)\b|\b(?:leave|keep)\b[^.!?]{0,20}\b(?:1099|w-?2|k-?1)\w*(?:-[a-z]+)? off\b/i,
  // Round 13 (11-12): "File an extension". A phone extension has a number after it.
  /(?:^|[.!?:;]\s+|\byou should\s+|\bi(?:'|’)?d\s+|\bjust\s+)(?:file|request|get)\b (?:for )?(?:an? |the )?(?:tax )?extension\b(?! \d)/i,
];
// In a sentence that talks about tax: telling them to do something, or what the rules say
// their money counts as. "You'll owe about $X" is a figure; "you should set aside $X" is advice.
const TAX_DIRECTIVE = [
  // "I'd need your 1099 to be exact" is Jane saying what it lacks, not what they should do.
  /\b(?:you should|you need to|you must|you(?:'|’)?d (?:want|need) to|you (?:could|can|may|might) (?:also )?(?:want to|try|consider|use|count|treat|report|put|move|open|contribute)|i(?:'|’)?d(?! (?:need|be|have|like|love|guess|say|expect))|i would(?! (?:need|be|have|like|love|guess))|i (?:recommend|suggest|advise)|consider|make sure|be sure to|don(?:'|’)?t forget|remember to|try to)\b/i,
  /\b(?:set|put) (?:aside|away)\b/i,
  /\b(?:counts?|treated|reported|qualif\w*|considered) as\b/i,
  /\b(?:is|are) (?:taxable|tax[- ]free|not taxable|deductible)\b/i,
  // In a tax sentence: filing a return, a schedule, a form or an extension.
  /\b(?:file|filing|amend\w*)\b[^.!?]{0,30}\b(?:returns?|schedule|form|extension)\b/i,
  // In a tax sentence: whether to report it ("you don't have to report it", "report it all").
  /\b(?:report|declare)\b (?:it|this|that|them|those|all|every)\b/i,
];

// The sentences that talk about tax and tell the person what to do about it.
// "My estimate of the tax is $367.20. You should set aside $367.20 for it." sets money aside for
// the tax of the sentence before.
const SET_ASIDE_FOR_IT =
  /\b(?:set|put) (?:aside|away)\b(?:[^.!?]|\.\d)*\b(?:it|that|this|them|those)\b/i;
function taxDirectives(text: string): boolean {
  const sentences = text.split(/(?<=[.!?])\s+/);
  const taxy = (s: string | undefined) => Boolean(s) && (TAX_WORD.test(s!) || IRS.test(s!));
  return sentences.some(
    (s, i) =>
      (taxy(s) && TAX_DIRECTIVE.some((p) => p.test(s))) ||
      (taxy(sentences[i - 1]) && SET_ASIDE_FOR_IT.test(s)),
  );
}
// Legal ADVICE, meaning directives and claims about the law: suing, going to court, a case
// the person could win, what they are legally entitled to. Mentioning a lawyer or an attorney,
// or the word "legal" on its own ("legal deductions", "the legal side"), is the opposite of
// advice, so it is not here (spec step 93 narrowed this too: a food court is a place to eat).
const LEGAL = [
  // A tenant holding back rent is a legal move with an eviction on the other side of it. Cutting
  // something else to cover the rent isn't, nor is not paying it twice.
  /(?<!\bif you )\b(?:withhold|hold back|stop (?:paying|sending)|don(?:'|’)t pay)\b(?![^.!?]*\b(?:twice|early)\b)(?:(?!\bto\b)[^.!?]){0,20}\b(?:rent|(?:the|your) landlord)\b/i,
  /\bskip(?:ping)? (?:(?:the|your) )?rent\b|\b(?:pay|put)\b[^.!?]{0,20}\brent\b[^.!?]{0,15}\bescrow\b/i,
  // The verb, never Sue the person ("You sent $40.00 to Sue for rent").
  /\bsue (?:them|him|her|you|it|the|a|an|for|over)\b/,
  /\b(?:you|we|they) (?:could|can|should|might|may|could also|can also) sue\b|\bsu(?:ed|ing)\b/i,
  /\blegal (?:grounds|action|claim|case|recourse|remedy|remedies)\b/i,
  /\blegally (?:required|obligated|bound|entitled|allowed to|can)\b/i,
  // What the person legally owes or can be made to do, and whether a debt can still be collected
  // (round 2, 11-06): "You don't legally owe that debt anymore", "Ignore the collector; the debt is
  // past the statute of limitations", "You have a strong case against your landlord".
  /\b(?:don(?:'|’)?t|do not|doesn(?:'|’)?t|does not|no longer|aren(?:'|’)?t|are not|isn(?:'|’)?t|is not|can(?:'|’)?t|cannot) legally\b/i,
  /\blegally (?:owe|have to|need to|responsible|liable|binding|enforceable)\b/i,
  /\b(?:past|beyond|outside|expired|run out|ran out)\b[^.!?]{0,30}\bstatute of limitations\b|\btime[- ]barred\b/i,
  // Chat policy round 9 (11-12): "The statute of limitations has run out on that debt", "Legally
  // they can't garnish your wages", "You don't have to pay it blindly; make them prove the debt".
  /\bstatute of limitations\b[^.!?]{0,30}\b(?:has |had |is )?(?:run out|ran out|passed|expired|ended|up|over)\b/i,
  /\blegally,? (?:they|you|he|she|it|the \w+|your \w+) (?:can(?:'|’)?t|cannot|can|must|have to|don(?:'|’)?t have to|do not have to)\b/i,
  /\bmake (?:them|the collector|the agency|the lender) prove\b|\b(?:don(?:'|’)?t|do not) have to pay (?:it|this|that|them|the debt)(?: back)? (?:blindly|at all)\b/i,
  // Holding back from a collector (chat policy round 10, 11-12): "Don't pay the collector until they
  // send validation".
  /\b(?:don(?:'|’)?t|do not|never|hold off on|wait to) pay(?:ing)? (?:the |a |that |this |any |your )?(?:debt )?(?:collectors?|collection agency|collections?|creditors?)\b/i,
  /\bignore (?:the |that |this |any |their |those )?(?:debt )?(?:collectors?|collection (?:letters?|calls?|notices?|agency)|lawsuit|summons|court (?:date|papers|notice)|subpoena)\b/i,
  /\b(?:have|has|got) (?:a |an )?(?:\w+ )?case against\b/i,
  // Chat policy round 10 (11-12): "Sue them in small claims court for the deposit", "You can break
  // your lease without penalty because of the mold", "Under the FCRA they have to delete it". An
  // insurance claim that is small ("I file small claims for you") is not a court.
  /(?:^|[.!?:;]\s+)Sue (?:them|him|her|the|your|their|in)\b/,
  /\bsmall[- ]claims (?:court|case|lawsuit|suit|judge)\b|\b(?:in|to|into) small[- ]claims\b/i,
  /\b(?:break|end|terminate|get out of) (?:your |the |a )?lease\b[^.!?]{0,30}\bwithout (?:a |any )?(?:penalty|penalties|fee|fees|paying)\b/i,
  /\b(?:have|has) (?:the |a )?right to (?:break|end|terminate|get out of|withhold|your deposit)\b|\b(?:are|is) (?:allowed|entitled) to (?:break|end|terminate|get out of|withhold)\b/i,
  /\bunder (?:the )?(?:fcra|fdcpa|fair credit reporting act|fair debt collection practices act|(?:state|federal|consumer protection|tenant|landlord[- ]tenant|your state(?:'|’)s) laws?|the law)\b[^.!?]{0,50}\b(?:have to|has to|must|can(?:'|’)?t|cannot|required|entitled|allowed|owe)\b/i,
  /\b(?:is |are |was |were )?(?:breaking|broke|violating|violated) the law\b/i,
  // Dressed up (chat policy round 3, 11-06): "Most lawyers would say you have a case", "You'd
  // likely win in small claims", "The collector has no right to call you at work", "You're
  // entitled to your full deposit back by law".
  /\b(?:have|has) a (?:strong |good |solid |winning |real )?(?:legal )?case\b(?! (?:open|number|id|with|about|on file|in progress|of|for (?:saving|keeping|cutting|paying)))/i,
  /\bwin\b[^.!?]{0,20}\b(?:small claims|in court|at trial)\b/i,
  /\b(?:has|have) no (?:legal )?right to\b/i,
  /\bentitled to\b[^.!?]{0,40}\b(?:by|under(?: the)?) law\b|\bthe law (?:says|requires|entitles|gives) you\b/i,
  /\b(?:take|took|taken|drag|dragged) (?:you |them |him |her |it |the \w+ )?to (?:small claims )?court\b/i,
  /\bfile (?:for (?:probate|divorce|custody)|(?:in|with) (?:the |a )?court)\b/i,
  /\b(?:don(?:'|’)?t|do not|doesn(?:'|’)?t|no) need (?:a |an )?(?:lawyer|attorney)\b/i,
  /\b(?:file|filed|filing|bring|start|pursue|threaten)\w* (?:a |the )?(?:lawsuit|litigation|suit)\b/i,
  /\b(?:win|lose) (?:the |a |your )?(?:case|lawsuit|suit)\b/i,
  // Spec step 229: what to do about bankruptcy or settlement is legal advice. The facts
  // Jane gives about them are fixed sentences (src/config/debt-trouble.ts) that pass below.
  /\bbankruptcy\b/i,
  /\bchapter (?:7|11|13)\b/i,
  /\bdebt settlement\b/i,
  // Spec step 268: what to do about an estate is legal advice: a trust, a will, a power of
  // attorney, avoiding probate, disclaiming an inheritance. Jane gives the tax facts and points
  // to an estate lawyer.
  /\b(?:set up|setting up|create|creating|draft|drafting|write|writing|update|updating|sign|change|amend|put (?:it|them|the \w+|your \w+) in) (?:a |an |your |the )?(?:(?:revocable|irrevocable|living|family|testamentary|special needs|bypass|credit shelter) )?(?:trust|will|power of attorney|living will|prenup(?:tial agreement)?)\b/i,
  /\bavoid(?:ing)? probate\b/i,
  /\bdisclaim(?:ing|er of)? (?:the |your |an |this |that )?(?:inheritance|bequest|inherited \w+|ira)\b/i,
  // Only a debt: "stop paying overdraft fees" is the opposite of legal trouble.
  /\b(?:stop|quit) paying (?:on |off )?(?:my |your |the |their )?(?:cards?|credit cards?|loans?|debts?|creditors?|collectors?|minimums?|mortgage|bills)\b/i,
  // Spec step 237: wills, trusts and what to do with an estate are legal advice. The facts
  // Jane gives are fixed sentences (src/config/family-file.ts) that pass below.
  /\b(?:last )?will and testament\b/i,
  /\b(?:revocable|irrevocable|living|testamentary|special[- ]needs|family)\s+trusts?\b/i,
  /\b(?:write|draft|make|update|change|sign|create|set up|file)\s+(?:a|an|your|my|the)\s+(?:new\s+)?(?:will|trust)\b/i,
  /\b(?:put|place|move|transfer)\b[^.!?]{0,60}\b(?:in|into)\s+(?:a|your|the)\s+trust\b/i,
  /\b(?:a|your|the)\s+(?:will|trust)\b[^.!?]{0,40}\b(?:better|best|instead|rather)\b/i,
  /\bprobate\b/i,
  /\bpower of attorney\b/i,
  /\bestate (?:plan|planning|tax)\b/i,
  /\bexecutor\b/i,
  // Claims about what a court does with what someone leaves (the reviewed fact says "usually").
  /\bcourts? (?:always|never|must|will|won(?:'|’)t|has to|have to|doesn(?:'|’)t have to)\b[^.!?]{0,40}\b(?:approve|decide|take|split|divide|get)\b/i,
  // Round 13 (11-12): legal letters and what they make a collector do ("Send them a cease and
  // desist letter", "Send a demand letter for your deposit", "they have to stop").
  /\bcease[- ](?:and|&)[- ]desist\b|\bdemand letter\b/i,
  /\b(?:have|has) to stop (?:contacting|calling|texting|emailing|writing to)\b/i,
];

// Saying Jane can't help with something legal, or pointing to a lawyer for it, is not legal
// advice: the sentence that does only that is taken out before checking. Only a sentence
// that says "can't" / "not able" or sends the person to a professional, and gives no
// instruction of its own ("you should sue").
const REFERRAL = [
  /\b(?:i|jane) (?:can(?:'|’)?t|cannot|can not|won(?:'|’)?t|am not able|am unable|(?:'|’)m not able)\b/i,
  /\bnot something (?:i|jane)\b/i,
  /\b(?:talk|speak|check|consult|ask|work|go|reach out|turn) (?:to|with) (?:a|an|your|the)\b[^.!?]{0,40}\b(?:lawyer|attorney|professional|expert|advisor|adviser)\b/i,
  /\b(?:a|an|your) (?:\w+ )?(?:lawyer|attorney) (?:can|could|is the right|would)\b/i,
];
// Naming who handles the legal part ("an estate attorney or the bank's bereavement team handles
// that") is a pointer, not advice, in both profiles.
const HANDLERS = [
  /\b(?:estate (?:attorney|lawyer)|probate (?:attorney|lawyer)|attorney|lawyer|bereavement team|estate team|executor)s?\b[^.!?]{0,60}\b(?:handles?|can help|can walk you|will walk you|knows how|is the right|are the right|can explain)\b/i,
];
// "I can't file this for you, but deduct the home office" refuses one thing and advises another.
// "But you can report a wrong charge to your bank" is what to do about a charge, not about taxes.
const ADVICE_OF_ITS_OWN =
  /\b(?:you should|you need to|you must|file for|sue)\b|\b(?:but|however|so)\b,?\s+(?:you (?:can|could|may)\s+)?(?:just\s+|do\s+|go ahead and\s+)?(?:deduct|claim|write off|itemi[sz]e|file|report|amend|hide|take (?:the|a) deduction)\b(?![^.!?]*\b(?:dispute|complaint|refund|bank|issuer|merchant|fraud)\b)/i;
// Jane saying it can't advise on investments ("I can't advise on investments here.") is the
// opposite of investment advice, in the standard profile too (11-01: the rewrite it was asked
// for was blocked again, so a real account got a canned line). Only a sentence that is nothing
// but the refusal: no "but…", no "I'd…", no suggestion after it.
const PURE_REFUSAL =
  /^\s*(?:i|jane) (?:can(?:'|’)?t|cannot|can not|won(?:'|’)?t|am not able to|(?:'|’)m not able to|am unable to|(?:'|’)m unable to)\s+(?:\w+\s+){0,2}?(?:advise|recommend|suggest|tell you|say|pick|choose|give (?:you )?(?:advice|recommendations?|a recommendation)|help (?:with|you (?:pick|choose)))\b/i;
const ADVICE_IN_REFUSAL =
  /\b(?:but|though|however|although|instead|except|i(?:'|’)?d|i would|you should|you could|you can|consider|try)\b|[;:]/i;

// "Legal deductions", "legal ways": the word as an adjective for what is allowed, not advice.
const BENIGN_LEGAL =
  /\blegal(?:ly)? (?:deductions?|credits?|ways?|options?|methods?|strateg\w+|tax breaks?|alternatives?|route)\b/gi;

// Sentences in which Jane refuses ("I can't help hide income from the IRS") or, in demo
// advice, points to a lawyer, are not advice about the thing they name: they are taken out
// before checking. `refusalsOnly` (the standard profile) takes out only its own "I can't".
function withoutReferrals(text: string, refusalsOnly = false): string {
  const patterns = [...(refusalsOnly ? REFERRAL.slice(0, 2) : REFERRAL), ...HANDLERS];
  const sensitive = [...LEGAL, ...TAX, ...TAX_ADVICE];
  return text
    .split(/(?<=[.!?])\s+/)
    .filter(
      (sentence) =>
        !(
          sensitive.some((p) => p.test(sentence)) &&
          patterns.some((p) => p.test(sentence)) &&
          !ADVICE_OF_ITS_OWN.test(sentence)
        ) &&
        !(
          INVESTMENT.some((p) => p.test(sentence)) &&
          PURE_REFUSAL.test(sentence) &&
          !ADVICE_IN_REFUSAL.test(sentence)
        ),
    )
    .join(" ");
}

// Spec step 229: the reviewed sentences about settlement, bankruptcy, forgiven-debt tax and
// where to take legal questions are taken out before checking. Only these exact sentences:
// any other line about them, or a changed word, is still checked in full.
function withoutApprovedSentences(text: string): string {
  return [
    ...APPROVED_DEBT_SENTENCES,
    ...APPROVED_FAMILY_SENTENCES,
    ...APPROVED_ESTATE_SENTENCES,
  ].reduce((t, sentence) => t.split(sentence).join(" "), text);
}

// "No guarantee", "can't promise", "isn't guaranteed": saying there is no promise isn't one.
const NEGATED_PROMISE =
  /\b(?:not|never|no|isn(?:'|’)?t|aren(?:'|’)?t|doesn(?:'|’)?t|don(?:'|’)?t|can(?:'|’)?t|cannot|won(?:'|’)?t|without)\s+(?:\w+\s+)?(?:a\s+|any\s+)?(?:guarantee\w*|promise\w*|definitely|certain\w*)\b/gi;

// (d) Promised outcomes. Savings are estimates: "could save about", never "will save".
const GUARANTEE = [
  /\bguarantee/i,
  /\bpromise/i,
  /\b(definitely|certainly|surely)\b/i,
  /\brisk[- ]free\b/i,
  /\bno risk\b/i,
  // "100% of your dining budget" is a figure; "100% sure" is a promise.
  /\b100 ?% (?:sure|certain|guaranteed|safe|risk[- ]free|chance|likely|covered|of the time)\b/i,
  // Getting paid on payday is a date, not a promise (spec step 93).
  /\b(will|you'll|you will) (save|get|recover|receive|earn)\b(?! paid\b)/i,
];

// (g) Deposit insurance (12 CFR 328.102; connectors roadmap round 13): no false or misleading word
// about it. Jane isn't a bank and holds nobody's money, so nothing is insured "with Jane"; and a
// Treasury, a money market fund, a stock, a bond or crypto is never FDIC insured. "Not FDIC
// insured" says so plainly, and stays allowed.
// Every way of saying it: "FDIC insured", "-backed", "protected by the FDIC", "carry FDIC insurance",
// "guaranteed by the FDIC", "protected up to $250,000 by the FDIC" (debugger 11-06), "FDIC eligible"
// (security round 48).
const FDIC_SAID =
  "(?:FDIC[- ](?:insured|backed|protected|covered|guaranteed|eligible)|(?:insured|protected|backed|covered|guaranteed)(?: up to \\$[\\d,.]+k?)? by (?:the )?FDIC|FDIC (?:insurance|coverage|protection))";
// What an investment is never called either: "T-bills are federally insured" (security round 48).
const INSURED_SAID = `(?:${FDIC_SAID}|federally insured)`;
// "Not FDIC insured" and its kin are the truth, said plainly; "no less FDIC insured" isn't.
const NOT_INSURED = new RegExp(
  `\\b(?:not|never|isn(?:'|’)?t|aren(?:'|’)?t|no)\\s+(?:(?!less\\b|more\\b)\\w+\\s+)?${INSURED_SAID}`,
  "gi",
);
const MONEY = "(?:money|cash|savings|deposits?|funds|balances?)";
const NEVER_INSURED =
  "(?:treasur(?:y|ies)|t-?bills?|money[- ]market funds?|stocks?|shares|bonds?|ETFs?|index funds?|crypto\\w*|bitcoin)";
// Until a bank word turns up, so "from a money market fund to savings with FDIC insurance" is fine.
const NO_BANK_WORD = "(?:(?!savings|deposit|bank|checking|\\bCDs?\\b)[^.!?]){0,40}";
const DEPOSIT_INSURANCE = [
  // Jane itself (or "Jane's account") said to be a bank or insured, not a clause that mentions it.
  new RegExp(
    `\\bJane(?:['’]s(?:\\s+\\w+){1,2})?\\s+(?:is|are)\\s+(?:an?\\s+)?(?:${FDIC_SAID}|(?:FDIC[- ]insured\\s+)?bank\\b)`,
    "i",
  ),
  // An account or balance named for Jane, said to be insured: "Jane accounts are FDIC insured",
  // "Your Jane balance is FDIC-insured" (security round 48).
  new RegExp(
    `\\bJane(?:['’]s)?\\s+(?:\\w+\\s+){0,2}?(?:accounts?|balances?|wallets?|cash|savings|money|funds|deposits?)\\s+(?:is|are)\\s+(?:\\w+\\s+)?${FDIC_SAID}`,
    "i",
  ),
  // Jane said to be an FDIC member, which only an insured bank may say (12 CFR 328): "Jane,
  // Member FDIC", "Jane is a member of the FDIC" (security round 48).
  /\bJane(?:['’]s)?,?\s+(?:is\s+)?(?:an?\s+)?member\s+(?:of\s+(?:the\s+)?)?FDIC\b/i,
  // Money said to be held by Jane, then insured: "Money held by Jane is insured up to $250,000"
  // (security round 48). "Nothing is held by Jane; your bank is insured" is two clauses.
  new RegExp(
    `\\b(?:held|kept|stored|parked|deposited)\\s+(?:by|with|at|in)\\s+Jane\\b[^.!?;]{0,30}?\\b(?:is|are|stays?)\\s+(?:(?!not\\b|never\\b)\\w+\\s+)?(?:${FDIC_SAID}|insured\\b|protected\\b)`,
    "i",
  ),
  // Money said to be with Jane, then insured: "your savings in Jane are insured".
  new RegExp(
    `\\b${MONEY}\\s+(?:\\w+\\s+){0,3}?(?:in|with|at|inside|through)\\s+Jane\\b[^.!?]{0,60}(?:${FDIC_SAID}|\\b(?:insured|protected)\\b)`,
    "i",
  ),
  new RegExp(`\\b(?:with|through|inside)\\s+Jane\\b[^.!?]{0,60}${FDIC_SAID}`, "i"),
  new RegExp(`${FDIC_SAID}[^.!?]{0,40}\\b(?:in|with|at|through)\\s+Jane\\b`, "i"),
  // Jane keeping or holding money, then insured: "Jane keeps your money FDIC insured" (debugger
  // 11-06). Not "Jane keeps an eye on whether your bank is FDIC insured".
  new RegExp(
    `\\bJane\\s+(?:keeps|holds|stores|puts)\\s+(?:\\w+\\s+){0,2}?${MONEY}\\b[^.!?]{0,60}(?:${FDIC_SAID}|\\binsured\\b)`,
    "i",
  ),
  // An investment is never FDIC insured, however it's put.
  new RegExp(`\\b${NEVER_INSURED}\\b${NO_BANK_WORD}${INSURED_SAID}`, "i"),
  // The FDIC said to insure one: "The FDIC insures your Treasuries" (debugger 11-06).
  new RegExp(
    `\\bFDIC\\s+(?:insures|guarantees|covers|protects|backs)\\b${NO_BANK_WORD}\\b${NEVER_INSURED}\\b`,
    "i",
  ),
];
export const misstatesDepositInsurance = (text: string): boolean => {
  const said = text.replace(NOT_INSURED, " ");
  return DEPOSIT_INSURANCE.some((pattern) => pattern.test(said));
};

// "$1,234.56", "$15", "$ 15.5", plus "15 dollars". A k/m suffix makes the figure unreadable
// for matching, so it counts as unsupported.
const DOLLAR_SIGN =
  /\$\s?((?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?)(\s?(?:k|m|bn|thousand|million|billion)\b)?/gi;
const DOLLAR_WORD = /\b((?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?)\s*(?:dollars|bucks|usd)\b/gi;

type Figure = { cents: number; wholeDollars: boolean; scaled: boolean };

function figureOf(match: RegExpMatchArray): Figure {
  const number = match[1].replaceAll(",", "");
  return {
    cents: Math.round(Number(number) * 100),
    wholeDollars: !number.includes("."),
    scaled: Boolean(match[2]),
  };
}

export function dollarFigures(text: string): Figure[] {
  return [DOLLAR_SIGN, DOLLAR_WORD].flatMap((pattern) => [...text.matchAll(pattern)].map(figureOf));
}

// (c) Every dollar figure must be one we gave Claude. A whole-dollar figure may round an
// amount ("$186" for $185.88).
function supported(figure: Figure, allowedCents: readonly number[]): boolean {
  if (figure.scaled) return false;
  return allowedCents.some((allowed) => {
    const amount = Math.abs(allowed);
    return figure.wholeDollars ? Math.abs(amount - figure.cents) < 100 : amount === figure.cents;
  });
}

// Wording some cards must use. A bill's price is compared with a typical price, never
// called too high as a fact.
export const REQUIRED_WORDING: Partial<Record<FindingType, RegExp>> = {
  bill_negotiation: /\btypical price\b/i,
};

// The dollar figures in text that nothing we gave Claude supports, as written.
export function unsupportedFigures(text: string, allowedCents: readonly number[]): string[] {
  const figures: string[] = [];
  for (const pattern of [DOLLAR_SIGN, DOLLAR_WORD]) {
    for (const match of text.matchAll(pattern)) {
      if (!supported(figureOf(match), allowedCents)) figures.push(match[0].trim());
    }
  }
  return figures;
}

// Which rules apply (spec step 98). "standard" is everyone with real data. "demo_advice" is
// for people in demo advice mode (src/lib/advice-mode.ts) only: recommendations on
// investments, taxes, insurance and loans may pass, while unsupported figures, promised
// outcomes and legal advice stay blocked. Text it passes carries DEMO_ADVICE_LABEL.
export type GuardrailProfile = "standard" | "demo_advice";

// A web link in Claude's words. Statements, emails and documents are written by other people
// (src/lib/untrusted-text.ts), and Jane's own pages go through buttons, so a link is passed on only
// to a government site or the free credit report site. A bare "AMZN.COM/BILL" or "WWW.COSTCO.COM" is
// how a statement names a merchant, so it isn't one.
const LINK = /\bhttps?:\/\/[^\s)>\]"']+|\bwww\.[^\s/)>\]"']+\/[^\s)>\]"']*/gi;
const TRUSTED_HOST = /(?:^|\.)(?:[a-z0-9-]+\.gov|annualcreditreport\.com)$/i;

const hostOf = (link: string) =>
  link
    .replace(/^https?:\/\//i, "")
    .split(/[/?#]/)[0]
    .split("@")
    .at(-1)!
    .split(":")[0]
    .replace(/\.+$/, "");

export const linksElsewhere = (text: string): string[] =>
  (text.match(LINK) ?? []).filter((link) => !TRUSTED_HOST.test(hostOf(link)));

// For text shown as written by someone else (a company's reply): the words stay, the link doesn't.
export const withoutLinks = (text: string): string =>
  text.replace(LINK, (link) => (TRUSTED_HOST.test(hostOf(link)) ? link : "[link removed]"));

// Telling the person to hand over what no company should ask for, or to pay in gift cards. "Never
// share your password" is the opposite, so a sentence that says not to doesn't count.
const CREDENTIAL_ASK =
  /\b(?:enter|give|send|share|provide|confirm|verify|type|tell|reply with|text|email|read out)\b(?:[^.!?\n]|\.\d){0,60}\b(?:passwords?|passcodes?|social security|ssn|one[- ]time (?:codes?|passwords?)|verification codes?|security codes?|cvv|cvc|pin|full (?:card|account) numbers?|seed phrases?|recovery phrases?)\b/i;
const GIFT_CARD_PAYMENT =
  /\b(?:buy|pay|paying|send|purchase)\b(?:[^.!?\n]|\.\d){0,40}\bgift cards?\b/i;
const SAYS_NOT_TO =
  /\b(?:never|don'?t|do not|not|won'?t|shouldn'?t|nobody|no one|can'?t|cannot)\b/i;

export const asksForCredentials = (text: string): boolean =>
  text
    .split(/(?<=[.!?])\s+|\n+/)
    .some(
      (sentence) =>
        !SAYS_NOT_TO.test(sentence) &&
        (CREDENTIAL_ASK.test(sentence) || GIFT_CARD_PAYMENT.test(sentence)),
    );

// Saying Jane did or will do something for someone. Nobody acts for a real account, and a person told
// "I've cancelled it" stops looking. The prompt says so too; what's allowed mustn't depend on that.
const DONE = "cancel(?:l)?ed|sent|filed|disputed|called|emailed|switched|negotiated|submitted|paid";
// "I sent you a reminder" can be true, "I called it your buffer" names something, and "I paid" is a
// person's words in a script far more than Jane's.
const SAID_DONE =
  "cancel(?:l)?ed|sent(?! you)|filed|disputed|called(?! (?:it|this|that|these)\\b)|emailed|switched|negotiated";
const DOING = "cancel(?:l)?ing|sending|filing|disputing|calling|emailing|switching|negotiating";
// "I'll call it your buffer" names something; nobody's phoned.
const WILL =
  "cancel|call(?! (?:it|this|that|these)\\b)|email|send|file|dispute|negotiate|switch|remind you";
const TEAM = "(?:the|our|my|Jane['’]s)(?: \\w+)? team";
const WHO = `(?:I|we|Jane|${TEAM})`;
// "I've now", "I went ahead and", "I also", "I quickly".
const THEN = "(?: \\w+ly| already| just| now| also| then| (?:go|went|gone) ahead and)*";
const ACT_CLAIMS: readonly RegExp[] = [
  new RegExp(`\\b${WHO}(?:['’]ve| have| has)${THEN} (?:${DONE})\\b`, "i"),
  // Not "Jane's paid membership" or "Jane's cancelled subscriptions list".
  new RegExp(`\\bJane['’]s${THEN} (?:${DONE}) (?:it|that|this|them|your|the)\\b`, "i"),
  // Not "I cancelled on May 2 but was still charged": a person's words, in a kit to copy.
  new RegExp(`\\b${WHO}${THEN} (?:${SAID_DONE})\\b(?! on\\b| but\\b)`, "i"),
  new RegExp(`\\b${WHO}(?:['’]ll| will)${THEN} (?:${WILL})\\b`, "i"),
  // Not "I'm calling on behalf of Sam": that's a script for the company, and Jane isn't its subject.
  new RegExp(
    `\\b(?:I['’]m|I am|we['’]re|we are|(?:Jane|${TEAM})(?: is|['’]s))${THEN} (?:${DOING})\\b(?! on behalf)`,
    "i",
  ),
  // Not "Jane's team can't": a refusal is the honest answer. Not "the team can often waive it": that
  // team may be a company's.
  /\b(?:our|my|Jane['’]s)(?: \w+)? team (?:will|has|is|can(?!['’]t|not\b))\b|\bthe team (?:will|has)\b/i,
];
// A script or a letter for the person to use is in their voice, not Jane's: in quotes, a quoted
// block, after "say:", or a "Dear ..." letter up to its sign-off and the name under it. A mark that
// only looks like a quote (12" subs) opens nothing, and words after a letter are Jane's again.
const QUOTED = /(^|[\s(:])["“][^"”]*["”]/gm;
const QUOTE_OPENS = /(?:^|[\s(:])["“]/m;
const GREETING = "(?:Dear\\b|To whom it may concern|(?:Hi|Hello)\\b[^\\n]*,[ \\t]*$)";
const SIGN_OFF =
  "(?:Sincerely|Yours sincerely|Yours truly|Kind regards|Best regards|Regards|Best|Many thanks|Thanks|Thank you|Respectfully|Cordially|Warmly|Cheers)";
const LETTER = new RegExp(`^${GREETING}[\\s\\S]*?^${SIGN_OFF}\\b[^\\n]*(?:\\n[^\\n]*)?$`, "gim");
const LETTER_OPENS = new RegExp(`^${GREETING}`, "im");
const SAYS = /\b(?:say|ask|tell them|write)(?: this| something like)?:(?!\s*["“]).*$/gim;
const withoutTheirWords = (text: string) =>
  text.replace(SAYS, " ").replace(QUOTED, "$1 ").replace(/^>.*$/gm, " ").replace(LETTER, " ");
export const claimsAnAct = (text: string): boolean => {
  const said = withoutTheirWords(text);
  return ACT_CLAIMS.some((p) => p.test(said));
};
// For an answer still being written: its quote or letter may close further on. The finished answer
// is checked as it stands, so one that never closes doesn't get to keep what it hid.
export function closingTheirWords(text: string): string {
  const closed = text.replace(QUOTED, "$1 ").replace(LETTER, " ");
  return `${text}${QUOTE_OPENS.test(closed) ? '"' : ""}${LETTER_OPENS.test(closed) ? "\n\nThanks,\nName" : ""}`;
}

// A reshop's words for a real account (round 14): none of RESHOP_BANNED_PHRASES, as whole words,
// with a curly apostrophe read as a straight one.
export function reshopBannedPhrases(text: string): string[] {
  const words = ` ${text
    .toLowerCase()
    .replace(/\u2019/g, "'")
    .replace(/[^a-z']+/g, " ")} `;
  return RESHOP_BANNED_PHRASES.filter((phrase) => words.includes(` ${phrase} `));
}

// The same rule for Claude's own words in the chat and anywhere else no finding is named (security
// round 48): a real account's answer never tells someone to switch insurers or drop a policy, and
// never calls another insurer cheaper or says it saves. Only in a sentence about insurance, so
// "Switch to T-Mobile; it's cheaper" stays a phone answer, and only to the person ("you", or an
// order), so a letter's "please cancel my policy" stays the person's own words.
const insurerName = (word: string) => [
  word.replace(/\b\w/g, (c) => c.toUpperCase()),
  word.toUpperCase(),
];
const INSURER = new RegExp(
  `\\b(?:${INSURER_KINDS.flatMap((k) => k.words.flatMap(insurerName)).join("|")})\\b`,
);
const ABOUT_INSURANCE =
  /\binsur(?:e|ed|er|ers|ance|ing)\b|\b(?:premiums?|deductibles?|policyholders?)\b|\b(?:auto|car|home|homeowners?|renters?|life|pet|health|umbrella|current|existing|insurance) polic(?:y|ies)\b/i;
const TO_THEM =
  "(?:^|[,;:]\\s*|\\b(?:you (?:should|could|can|might|may want to)|i(?:'|’)?d|consider|just|then|and|so|maybe|go ahead and)\\s+)";
const RESHOP_STEERING: readonly { why: string; pattern: RegExp }[] = [
  {
    why: "switch",
    pattern: new RegExp(
      `${TO_THEM}(?:switch(?:\\s+over)?(?:\\s+(?:to|carriers|insurers|companies|providers|polic(?:y|ies))\\b|\\s*[.!?]?$)|move(?:\\s+over)?\\s+to\\s+(?:${INSURER.source}|(?:another|a (?:new|different|cheaper)) (?:insurer|carrier|company|policy)\\b))|\\b(?:consider|try|recommend|suggest)\\s+switching\\b`,
      "i",
    ),
  },
  {
    why: "drop the policy",
    pattern:
      /(?<!\b(?:don(?:'|’)?t|do not|never|not|before you|until you)\s)\b(?:cancel|drop|ditch|dump|leave|end)\s+your\s+(?:current\s+|existing\s+|old\s+)?(?:\w+\s+){0,2}?(?:polic(?:y|ies)|coverage|insurance|insurer|carrier)\b/i,
  },
  {
    why: "drop the insurer",
    pattern: new RegExp(`${TO_THEM}(?:cancel|drop|ditch|dump|leave)\\s+${INSURER.source}`, "i"),
  },
  {
    why: "cheaper",
    pattern:
      /\b(?:cheaper|less expensive|lower[- ](?:priced|cost)|better (?:deal|price|rate|value|coverage)|same coverage for less)\b|\b(?:would|could|might|may|will)\s+(?:cost|pay)\s+(?:you\s+(?:\$[\d,.]+\s+)?|\$[\d,.]+\s+)less\b|\bcosts?\s+\$[\d,.]+\s+less\b/i,
  },
  {
    why: "saves",
    pattern:
      /\b(?:you(?:'|’)?ll|you will|you(?:'|’)?d|you could|you can|you might|could|would|will)\s+(?:likely\s+|probably\s+|easily\s+)?save\b/i,
  },
];

// What in the text steers someone off their policy. `everySentence` for a reshop's own words,
// which are all about insurance.
export function reshopSteering(text: string, { everySentence = false } = {}): string[] {
  const found = new Set<string>();
  for (const sentence of text.split(/(?<=[.!?])\s+|\n+/)) {
    if (!everySentence && !ABOUT_INSURANCE.test(sentence) && !INSURER.test(sentence)) continue;
    for (const { why, pattern } of RESHOP_STEERING)
      if (pattern.test(sentence.trim())) found.add(why);
  }
  return [...found];
}

type Scan = { issues: GuardrailIssue[]; matched: string[] };

function scan(
  text: string,
  allowedCents: readonly number[],
  findingType: FindingType | undefined,
  profile: GuardrailProfile,
): Scan {
  const issues: GuardrailIssue[] = [];
  const matched: string[] = [];
  const advice = profile === "demo_advice";
  const original = text;
  text = withoutApprovedSentences(text);
  text = text.replace(BENIGN_LEGAL, "allowed");
  // A refusal isn't advice; in demo advice a pointer to a lawyer isn't either.
  text = withoutReferrals(text, !advice);
  const hits = (patterns: readonly RegExp[], label: string) => {
    const found = patterns.filter((p) => p.test(text));
    matched.push(...found.map((p) => `${label}:${p.source.slice(0, 60)}`));
    return found.length > 0;
  };
  const required = findingType && REQUIRED_WORDING[findingType];
  if (required && !required.test(original)) issues.push("missing_required_wording");
  if (!advice && hits(INVESTMENT, "investment")) issues.push("investment_advice");
  let tax = !advice && hits(TAX_ADVICE, "tax");
  if (!advice && taxDirectives(text)) {
    tax = true;
    matched.push("tax:directive");
  }
  const legal = hits(LEGAL, "legal");
  if (tax || legal) issues.push("tax_or_legal_advice");
  if (dollarFigures(text).some((f) => !supported(f, allowedCents))) {
    issues.push("unsupported_dollar_figure");
  }
  const unnegated = text.replace(NEGATED_PROMISE, " ");
  const promised = GUARANTEE.filter((p) => p.test(unnegated));
  if (promised.length > 0) {
    issues.push("guaranteed_outcome");
    matched.push(...promised.map((p) => `guarantee:${p.source.slice(0, 60)}`));
  }
  if (linksElsewhere(original).length > 0) {
    issues.push("untrusted_link");
    matched.push("link");
  }
  if (asksForCredentials(original)) {
    issues.push("credential_request");
    matched.push("credentials");
  }
  // In every profile: demo advice is still never allowed to misstate deposit insurance.
  if (misstatesDepositInsurance(original)) {
    issues.push("deposit_insurance");
    matched.push("deposit_insurance");
  }
  // A reshop for a real account never says it saves or tells them to switch (round 14), nor does
  // any answer about insurance with no finding named (the chat).
  const reshop = advice
    ? []
    : findingType === "insurance_reshop"
      ? [...reshopBannedPhrases(original), ...reshopSteering(original, { everySentence: true })]
      : findingType === undefined
        ? reshopSteering(original)
        : [];
  if (reshop.length > 0) {
    issues.push("insurance_comparison");
    matched.push(...reshop.map((phrase) => `insurance_comparison:${phrase}`));
  }
  // From the words with their lines still in them, which is how a letter is told apart.
  if (!advice && claimsAnAct(withoutApprovedSentences(original))) {
    issues.push("claimed_action");
    matched.push("claimed_action");
  }
  return { issues, matched };
}

export function checkGuardrails(
  text: string,
  allowedCents: readonly number[],
  findingType?: FindingType,
  profile: GuardrailProfile = "standard",
): GuardrailResult {
  const { issues } = scan(text, allowedCents, findingType, profile);
  return issues.length === 0 ? { ok: true } : { ok: false, issues };
}

// Which rules matched, as the rule's own pattern (never the person's words), so a block can be
// traced in the logs.
export function guardrailMatches(
  text: string,
  allowedCents: readonly number[],
  profile: GuardrailProfile = "standard",
): string[] {
  return scan(text, allowedCents, undefined, profile).matched;
}

// An answer split into the sentences that pass on their own and the ones that don't, so a
// blocked answer can be rewritten without its advice (Claude is shown what was dropped) and,
// failing that, shown with only its facts. Lines and sentences both count as sentences.
export function splitByGuardrails(
  text: string,
  allowedCents: readonly number[],
  profile: GuardrailProfile = "standard",
): { kept: string[]; dropped: { sentence: string; issues: GuardrailIssue[] }[] } {
  const kept: string[] = [];
  const dropped: { sentence: string; issues: GuardrailIssue[] }[] = [];
  for (const sentence of text.split(/(?<=[.!?])\s+|\n+/).map((s) => s.trim())) {
    if (!sentence) continue;
    const check = checkGuardrails(sentence, allowedCents, undefined, profile);
    if (check.ok) kept.push(sentence);
    else dropped.push({ sentence, issues: check.issues });
  }
  return { kept, dropped };
}

// A forecast of a price or the market (spec step 293): news summaries say what happened, never
// where a price is going, in every profile. "Shares slipped" is a fact; "shares could rebound"
// and "a price target of" are predictions.
const PRICE_PREDICTION = [
  /\b(?:will|would|could|should|may|might|can|going to|set to|poised to|expected to|likely to|bound to|about to|due to|ready to)\s+(?:\w+\s+){0,3}?(?:rise|rally|climb|jump|soar|surge|spike|fall|drop|decline|sink|slide|slip|plunge|plummet|tumble|crash|rebound|recover|bounce|gain|lose|double|halve|go (?:up|down)|head (?:higher|lower)|outperform|underperform|beat the market)\b/i,
  /\b(?:price|share|stock) (?:target|forecast|prediction|outlook)\b/i,
  /\btarget price\b/i,
  /\b(?:heading|headed|poised|set) (?:for )?(?:higher|lower|a (?:rally|rebound|drop|fall|crash))\b/i,
  /\b(?:upside|downside) (?:of|to)\b/i,
  /\b(?:predict\w*|forecast\w*|expect\w*)\b[^.!?]{0,40}\b(?:prices?|shares?|stocks?|the market|returns?)\b[^.!?]{0,30}\b(?:rise|rally|climb|fall|drop|recover|rebound|gain|higher|lower|up|down)\b/i,
  /\b(?:a )?(?:good|great|bad) time to (?:buy|sell)\b/i,
  /\b(?:bottom(?:ed)? out|has (?:further|more) to (?:fall|run|go))\b/i,
];

export function predictsAPrice(text: string): boolean {
  return PRICE_PREDICTION.some((pattern) => pattern.test(text));
}

// (e) Recommending one choice over another. The debt planner is education: it shows the
// math for each order of paying cards down and leaves the choice to the person.
const RECOMMENDATION = [
  /\byou should\b/i,
  /\b(we|i) (recommend|suggest|advise)\b/i,
  // "Not a recommendation" is how the planner says it doesn't recommend, so it's allowed.
  /\brecommended\b/i,
  /\b(our|my) recommendation\b/i,
  /\b(best|better|smartest|right|wisest) (choice|option|strategy|plan|way|approach)\b/i,
  /\bgo with\b/i,
  /\bpick (the )?(avalanche|snowball)\b/i,
];

export function recommendsAChoice(text: string, profile: GuardrailProfile = "standard"): boolean {
  if (profile === "demo_advice") return false;
  return RECOMMENDATION.some((pattern) => pattern.test(text));
}

// Insurance and loans, the two advice sectors the standard rules don't block by word.
const INSURANCE_OR_LOANS = [
  /\binsur/i,
  /\b(polic(y|ies)|premiums?|coverage|deductibles?|carriers?)\b/i,
  /\b(loans?|mortgages?|refinanc\w*|apr|interest rates?|lenders?|debt)\b/i,
];

// Whether text is about investing or taxes, said as a fact or as advice: what an answer needs
// AI_WRITTEN_LABEL for (src/config/advice.ts).
export const aboutInvestingOrTaxes = (text: string): boolean =>
  [...INVESTMENT, ...TAX].some((pattern) => pattern.test(text));

// Whether text is advice that needs DEMO_ADVICE_LABEL (spec step 98): it talks about
// investments, taxes, insurance or loans, or recommends one choice over another.
export function isAdvice(text: string): boolean {
  return [...INVESTMENT, ...TAX, ...INSURANCE_OR_LOANS, ...RECOMMENDATION].some((p) =>
    p.test(text),
  );
}
