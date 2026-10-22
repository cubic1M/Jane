import { US_STATES } from "@/config/referrals";
import type { FilingStatus, TaxTagKind } from "@/config/tax";
import type { DecisionTopic } from "@/config/tax-decisions";

// What the person typed about taxes (spec steps 118–127), understood by rules. Pure: the
// normalized text in (./intents.ts normalize), a tax intent out, or null when it isn't
// about taxes. Typing never changes anything by itself: each answer offers a button.

export type TaxIntent =
  // Taxes in the chat: a direct answer to a decision or a fact.
  | { kind: "tax"; ask: "decide"; topic: DecisionTopic }
  | { kind: "tax"; ask: "profile" }
  // status null: "I'm married", which could be either way.
  | { kind: "tax"; ask: "set_filing"; status: FilingStatus | null }
  | { kind: "tax"; ask: "set_kids"; count: number }
  | { kind: "tax"; ask: "set_state"; state: string }
  // Spec step 119: the tags, one tag's total, tagging a merchant, the forms, the pack.
  | { kind: "tax"; ask: "tags" }
  | { kind: "tax"; ask: "tag_total"; tag: TaxTagKind }
  | { kind: "tax"; ask: "tag"; target: string; tag: TaxTagKind | null }
  | { kind: "tax"; ask: "forms" }
  | { kind: "tax"; ask: "pack" }
  // Spec step 120: the estimate and the top rate.
  | { kind: "tax"; ask: "estimate" }
  | { kind: "tax"; ask: "bracket" }
  // Spec step 121: the withholding checkup.
  | { kind: "tax"; ask: "withholding" }
  // Spec step 122: ways to pay less.
  | { kind: "tax"; ask: "savings" }
  // Spec step 123: freelancers.
  | { kind: "tax"; ask: "quarterly" }
  | { kind: "tax"; ask: "set_aside" }
  | { kind: "tax"; ask: "home_office" }
  | { kind: "tax"; ask: "miles"; miles: number | null }
  // Spec step 125.
  | { kind: "tax"; ask: "refund" }
  // Spec step 126.
  | { kind: "tax"; ask: "file" }
  // Spec step 127.
  | { kind: "tax"; ask: "standard_deduction" }
  // Spec step 124.
  | { kind: "tax"; ask: "investments" }
  // Spec step 165: a move ("from" null: the profile's state; month null: not said), an
  // employer in another state, and the state taxes.
  | {
      kind: "tax";
      ask: "move";
      from: string | null;
      to: string;
      month: number | null;
      day: number | null;
    }
  | { kind: "tax"; ask: "work_state"; state: string }
  | { kind: "tax"; ask: "states" }
  // Spec step 167.
  | { kind: "tax"; ask: "plan" }
  // Spec step 168.
  | { kind: "tax"; ask: "giving" }
  // Spec step 169.
  | { kind: "tax"; ask: "family" }
  // Spec step 170.
  | { kind: "tax"; ask: "home" }
  // Spec step 171.
  | { kind: "tax"; ask: "records" }
  // Spec step 172.
  | { kind: "tax"; ask: "last_return" }
  // Spec step 173.
  | { kind: "tax"; ask: "side_income" }
  // Spec step 217.
  | { kind: "tax"; ask: "notice" }
  // Spec step 219.
  | { kind: "tax"; ask: "equity" }
  // Spec step 220: taxes over the years, and the year the person plans to retire.
  | { kind: "tax"; ask: "years" }
  // Spec step 221: property tax too high, and exemptions.
  | { kind: "tax"; ask: "property" }
  // Spec step 222: working with an accountant.
  | { kind: "tax"; ask: "accountant" }
  // Spec step 223: the tax calendar.
  | { kind: "tax"; ask: "calendar" }
  // Spec step 267: business owners' tax structure.
  | { kind: "tax"; ask: "business" }
  // Spec step 268: inherited money and gifts.
  | { kind: "tax"; ask: "inherited" }
  // Spec step 269: the tax side of health insurance.
  | { kind: "tax"; ask: "health" }
  // Spec step 270: disaster relief and losses, and the county the person lives in.
  | { kind: "tax"; ask: "disaster" }
  // Spec step 271: taxes on retirement income.
  | { kind: "tax"; ask: "retirement" }
  | { kind: "tax"; ask: "set_county"; county: string }
  | { kind: "tax"; ask: "retire_year"; year: number }
  // Spec step 218: a sign of identity theft, or the IP PIN.
  | { kind: "tax"; ask: "identity"; sign: "efile_rejected" | "unknown_form" | "irs_letter" | null };

const NUMBER_WORDS: Readonly<Record<string, number>> = {
  no: 0,
  zero: 0,
  none: 0,
  a: 1,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
};

const PROFILE =
  /\btax profile\b|\bmy filing status\b|\bwhat do you know about my tax(?:es)?\b|^(?:my )?tax(?:es)?$|\bset up my tax(?:es)?\b|\bwith (?:my )?tax(?:es)?$|\bget (?:my )?tax(?:es)? (?:ready|sorted|done)\b/;

const FILING: readonly [RegExp, FilingStatus][] = [
  [
    /\bmarried filing (?:jointly|joint(?:ly)?|together)\b|\bfile jointly\b|\bfiling jointly\b/,
    "married_joint",
  ],
  [/\bmarried filing separately\b|\bfile separately\b|\bfiling separately\b/, "married_separate"],
  [/\bhead of (?:the )?household\b/, "head_of_household"],
  [/\b(?:i'?m|i am|i'll be|i will be|file as|filing as|status is) single\b/, "single"],
];
const MARRIED = /^(?:i'?m|i am|we'?re|we are|i got|we got) (?:now )?married$/;

const KIDS =
  /\bi(?: have| got| claim| will claim|'ll claim) (\d{1,2}|no|zero|a|one|two|three|four|five|six) (?:kids?|children|child|dependents?|dependants?)\b/;

const STATE = /\b(?:i|we) (?:live|moved|file|reside|am|'m) (?:in|to) ([a-z][a-z .]{1,30})$/;

const TAGS =
  /\btax tags?\b|\btagged for (?:my )?tax(?:es)?\b|\bwhat(?:'s| is| have you| did you) tag(?:ged)?\b/;
const DONATIONS =
  /\bhow much (?:have i|did i|i've) (?:given|give|donated?)\b|\b(?:my )?(?:donations|charity|charitable giving|giving) (?:this year|so far|total)\b|\bdonated (?:this year|so far)\b/;
const TAG_TOTAL =
  /\b(medical|childcare|education|work) (?:expenses? |costs? |spending |bills )?(?:for (?:my )?tax(?:es)?|tagged|this year for tax(?:es)?)\b/;
const TAG_WORDS: Readonly<Record<string, TaxTagKind>> = {
  donation: "donation",
  donations: "donation",
  charity: "donation",
  medical: "medical",
  childcare: "childcare",
  education: "education",
  work: "work",
  "work expense": "work",
  "work expenses": "work",
  rental: "rental",
  "rental expense": "rental",
  "rental expenses": "rental",
};
const TAG =
  /^tag (?:my |the |all )?(?:charges? (?:from|at) )?(.+?) (?:charges? |payments? |purchases? )?as (?:a |an )?(donations?|charity|medical|childcare|education|work(?: expenses?)?|rental(?: expenses?)?)$/;
const UNTAG =
  /^(?:untag|don't tag|do not tag|stop tagging) (?:my |the |all )?(.+?)(?: for tax(?:es)?)?$/;
const FORMS =
  /\b(?:tax )?(?:forms?|documents?|paperwork) (?:do i need|to expect|am i waiting (?:on|for)|should i (?:get|expect)|for (?:my )?tax(?:es)?)\b|\b(?:my |a |the )?(?:w-?2s?|1099s?|1098s?)\b/;
// About taxes, not debts: "how much do I owe" is the loans' question (step 109).
const ESTIMATE =
  /\bhow much (?:tax|taxes) (?:will|do|would) (?:i|we) (?:owe|pay)\b|\bhow much (?:tax )?(?:will|do|would) (?:i|we) (?:get back|pay in tax(?:es)?|have to pay in tax(?:es)?)\b|\b(?:will|do) (?:i|we) (?:get a refund|get money back)\b|\btax (?:estimate|bill|refund)\b|\bestimated? (?:tax|refund)\b|\brefund this year\b/;
// "How much do I owe?" is about debts (./debt-intents.ts) unless it says tax.
const OWE =
  /\bhow much (?:tax )?(?:will|do|would) (?:i|we) owe\b|\b(?:will|do|what (?:will|do)) (?:i|we) owe\b/;
const TAX_WORD = /\b(?:tax(?:es)?|irs|refund|return)\b/;
const BRACKET = /\btax bracket\b|\bmarginal (?:tax )?rate\b|\bwhat bracket\b|\bmy bracket\b/;
const WITHHOLDING =
  /\bw-?4\b|\bwithholding\b|\bwithhold(?:ing)? (?:enough|too much|too little|more|less)\b|\b(?:am i|are we) (?:having|getting) enough (?:tax )?(?:taken|withheld)\b|\btoo much (?:tax )?(?:taken out|withheld)\b/;
const SAVINGS =
  /\bpay less (?:in )?tax(?:es)?\b|\bsave (?:on|money on) (?:my )?tax(?:es)?\b|\btax savings?\b|\b(?:lower|reduce|cut) (?:my |our )?tax(?:es| bill)?\b|\btax (?:breaks?|deductions?|credits?)\b|\bwhat (?:can|could) i deduct\b|\bdeductions? (?:can|could) i (?:take|claim)\b/;
const QUARTERLY_ASK =
  /\b(?:quarterly|estimated) (?:tax(?:es)?|payments?|tax payments?)\b|\bself[- ]employment tax\b|\b1040-?es\b/;
const SET_ASIDE =
  /\bset aside\b.*\btax(?:es)?\b|\bhow much (?:should|do) i (?:save|put aside|set aside|keep) for tax(?:es)?\b/;
const HOME_OFFICE = /\bhome office\b/;
const MILES_ADD =
  /\b(?:i )?(?:drove|driven|log|add|record) (\d{1,3}(?:,\d{3})*|\d+) (?:business |work )?miles\b/;
const MILEAGE = /\b(?:business |work )?mileage\b|\bbusiness miles\b/;
const REFUND_ASK =
  /\bwhere(?:'s| is) my (?:tax )?refund\b|\b(?:did|has) my (?:tax )?refund (?:come|arrive|land|come in)\b|\bwhat (?:should|could) i do with my (?:tax )?refund\b|\bmy tax refund\b/;
const FILE =
  /\bfile (?:my |our )?(?:tax(?:es)?|return|tax return)\b|\b(?:my |our )?tax return\b|\btax deadline\b|\bwhen (?:are|is) (?:my |our )?tax(?:es)? due\b|\b(?:status of|where is) my return\b/;
// "What is the standard deduction" is the learn explainers' (step 136); whether to itemize
// is the person's own question, answered from their estimate.
const STANDARD =
  /\bshould (?:i|we) itemi[sz]e\b|\b(?:do|will|would) (?:i|we) itemi[sz]e\b|\bitemi[sz]e or not\b|\bitemi[sz]ing worth it\b/;
// Capital gains, harvesting and asset location in general are the investments lane's
// (step 135, ./investments/intents.ts); these are what step 124 adds.
const INVESTMENT_TAX =
  /\breali[sz]ed (?:gains?|losses?)\b|\bharvest (?:my )?loss(?:es)?\b|\bwash sales?\b|\b(?:gains|losses) (?:on|from) (?:my )?(?:sales|selling)\b/;
// Spec step 165. State names only: two-letter codes are everyday words ("in", "or", "me").
const STATE_NAMES = US_STATES.map((s) => s.name.toLowerCase()).join("|");
const MONTHS = [
  "january",
  "february",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
];
const MOVE = new RegExp(
  `\\b(?:i|we) (?:moved|relocated)(?: from (${STATE_NAMES}))? to (${STATE_NAMES})(?: (?:in|on|at the (?:start|beginning|end) of) (${MONTHS.join("|")})(?: (\\d{1,2})(?:st|nd|rd|th)?)?)?(?: this year| last year)?$`,
);
const WORK_STATE = new RegExp(
  `\\b(?:i|we) work (?:remotely |from home )?for (?:a |an )?(?:company|employer|firm|business) (?:based |that's |that is )?(?:in|out of) (${STATE_NAMES})\\b|\\bmy (?:employer|company|job) is (?:based )?in (${STATE_NAMES})\\b`,
);
const STATES_ASK =
  /\bstate (?:income )?tax(?:es)?\b|\b(?:local|city) (?:income )?tax(?:es)?\b|\btax(?:es)? in (?:two|2|both|more than one|multiple) states\b|\bpart[- ]year (?:resident|return)\b|\bnonresident (?:return|tax)\b/;
const PLAN =
  /\btax (?:plan|calendar|moves|deadlines|to-?dos?)\b|\b(?:year-end|end of (?:the )?year|year end) tax(?:es| moves| planning)?\b|\bwhat (?:tax )?(?:moves|deadlines) (?:are )?(?:coming|left|ahead)\b|\bwhat should i do (?:for|about) (?:my )?tax(?:es)? (?:this year|before (?:the )?year end|before december)\b/;
const GIVING_ASK =
  /\bdonor[- ]advised fund\b|\bdaf\b|\bbunch(?:ing)? (?:my )?(?:gifts|giving|donations)\b|\b(?:donate|give|gift) (?:stock|shares|appreciated (?:stock|shares))\b|\b(?:give|donate|giving) (?:smarter|better|tax[- ]efficiently)\b|\bhow should i (?:give|donate)\b|\b(?:charity|donation) receipts?\b|\breceipts? for (?:my )?(?:donations|gifts|charity)\b/;
// Questions, not answers: "should we file jointly or separately" compares; "we file
// jointly" sets the profile (FILING).
const FAMILY_ASK =
  /\b(?:jointly or separately|separately or jointly|joint or separate|separate or joint)\b|\bhead of household or single\b|\bsingle or head of household\b|\bchild tax credit\b|\bdependent care (?:fsa|credit|account)\b|\bfsa or (?:the )?(?:care |childcare )?credit\b|\bamerican opportunity\b|\blifetime learning\b|\b(?:aotc|llc credit)\b|\beducation credits?\b|\b529 (?:tax|deduction|break|benefits?)\b|\bfamily tax(?:es)?\b|\btax(?:es)? (?:for|with) (?:my |our )?(?:kids|children|family)\b/;
const HOME_ASK =
  /\bmortgage interest\b|\bproperty tax(?:es)?\b|\bsalt (?:cap|deduction)\b|\bstate and local tax (?:cap|deduction)\b|\b(?:sold|selling|sell) (?:my |our )?(?:house|home)\b|\bhome sale\b|\bcapital gains? on (?:my |our |the )?(?:house|home)\b|\bmortgage points\b|\bhome(?:owner)? tax(?:es)?\b|\btax(?:es)? on (?:my |our )?(?:house|home)\b/;
const RECORDS_ASK =
  /\baudit pack\b|\baudit(?:-| )ready\b|\b(?:tax )?records? (?:for|if|in) (?:an )?audit\b|\bhow long (?:should|do) (?:i|we) (?:keep|hold on to)\b.*\b(?:tax|records?|receipts?|papers)\b|\bwhat if (?:i|the irs) (?:get|gets|am|audits?)\b.*\baudit|\bam i ready for an audit\b|\b(?:get|got|am|being) audited\b|\bkeep (?:my )?(?:tax )?(?:records|receipts|papers)\b/;
const LAST_RETURN =
  /\b(?:last year'?s|my (?:old|prior|previous)) (?:tax )?return\b|\b(?:review|check|look at|read) my (?:tax )?return\b|\bamend(?:ed)? (?:my |a )?(?:tax )?return\b|\b1040-?x\b|\b(?:did i|have i) miss(?:ed)? (?:anything|any|a) (?:deductions?|credits?|on my (?:tax )?return)\b|\b(?:left|leave|leaving) money on the table\b/;
const SIDE_INCOME =
  /\brental (?:income|property|properties|expenses?|taxes|losses?)\b|\b(?:my )?(?:airbnb|rental)\b.*\btax(?:es)?\b|\bdepreciat(?:e|ion)\b|\b(?:gig|side|freelance) (?:income|hustle|work|gig)\b.*\b(?:tax|1099|hobby|business)\b|\bhobby (?:or|vs\.?|versus) business\b|\bis (?:my|this) (?:side )?(?:gig|income|hustle) a (?:hobby|business)\b|\bplatform (?:payouts?|1099)\b|\b1099-?k\b|\bpassive loss\b/;
const NOTICE_ASK =
  /\b(?:irs|tax|state tax|franchise tax board) (?:notice|letter)\b|\b(?:notice|letter) from the (?:irs|state|franchise tax board|department of revenue)\b|\bcp2000\b|\bcp14\b|\bcp501\b|\bcp503\b|\bcp504\b|\bthe irs (?:sent|says|wrote)\b|\bgot a (?:scary )?(?:letter|notice) (?:about|from)\b.*\b(?:tax|irs)/;
const IDENTITY_REJECTED =
  /\b(?:return|e-?file|filing) (?:was |got |has been )?rejected\b.*\b(?:already|duplicate|someone)\b|\b(?:someone|somebody) (?:already )?(?:filed|used)\b.*\b(?:my|taxes|return|social)\b|\balready (?:been )?filed (?:a return )?(?:for me|with my|under my)\b/;
const IDENTITY_FORM =
  /\b(?:w-?2|1099)\b.*\b(?:don'?t|do not|never) (?:know|recogni[sz]e|worked)\b|\b(?:w-?2|1099) from (?:a |an )?(?:company|employer|payer) (?:i|that i) (?:don'?t|never|didn'?t)\b|\bunknown (?:employer|payer)\b/;
const IDENTITY_LETTER =
  /\b(?:irs|tax) (?:letter|notice)\b.*\b(?:return|refund) (?:i|that i) (?:didn'?t|did not|never) file\b|\bletter about a return i (?:didn'?t|did not|never) file\b/;
const IDENTITY_ASK =
  /\bip pin\b|\bidentity protection pin\b|\btax identity theft\b|\bidentity theft\b.*\b(?:tax|irs|return)\b|\b(?:tax|irs|return)\b.*\bidentity theft\b|\bform 14039\b|\bprotect my (?:tax )?identity\b|\bstolen (?:social security|ssn)\b.*\b(?:tax|irs)\b/;
const EQUITY_ASK =
  /\b(?:crypto|bitcoin|ethereum)\b.*\b(?:tax|taxes|gains?|losses|1099)\b|\b(?:tax|taxes)\b.*\b(?:crypto|bitcoin|ethereum)\b|\bespp\b.*\b(?:tax|taxes|taxed|taxable|disqualif\w*|qualifying)\b|\b(?:tax|taxes|taxed)\b.*\bespp\b|\brsus?\b.*\b(?:tax|taxes|withh)|\b(?:tax|taxes|withh)\w*\b.*\brsus?\b|\b(?:iso|isos|incentive stock options?)\b|\bamt\b|\balternative minimum tax\b|\b1099-da\b|\bdisqualifying disposition\b|\bstock options?\b.*\btax/;
const YEARS_ASK =
  /\b(?:taxes|tax bill)\b.*\b(?:over (?:the )?(?:next )?(?:several |many |few |\d+ )?years|in retirement|multi[- ]?year)\b|\bmulti[- ]?year (?:tax|plan)\b|\broth conversions?\b|\bconvert (?:my )?(?:401k|401\(k\)|ira|traditional \w+)\b.*\broth\b|\bbunch(?:ing)? (?:my )?deductions\b|\b0% (?:capital gains )?(?:tax )?bracket\b|\bwhen (?:should|do) i (?:take|time) (?:my |the |a )?(?:bonus|withdrawal)\b.*\btax/;
const PROPERTY_ASK =
  /\bproperty tax(?:es)?\b.*\b(?:too high|appeal|assess\w*|lower|reduce|exempt\w*|protest)\b|\b(?:appeal|protest|contest|challenge)\b.*\b(?:property tax(?:es)?|assessment|assessed value)\b|\bover-?assessed\b|\bassessed (?:value|too high)\b|\bhomestead exemption\b|\b(?:senior|veteran|veterans)\b.*\bproperty tax\b/;
const ACCOUNTANT_ASK =
  /\baccountants?\b.*\b(?:link|share|send|give|hand|access|answer)\w*\b|\b(?:share|send|give|hand)\b.*\b(?:accountant|cpa|tax (?:preparer|pro|professional))\b|\b(?:do|should) i (?:need|use|hire|get) (?:an? )?(?:accountant|cpa|tax (?:preparer|pro|professional))\b|\bwork(?:ing)? with (?:an? |my )?(?:accountant|cpa)\b|\bmy (?:accountant|cpa) (?:wrote|answered|replied|said)\b/;
const CALENDAR_ASK =
  /\btax year (?:calendar|runs)\b|\b(?:taxes|tax stuff)\b.*\bthis month\b|\bwhat(?:'s| is)? (?:due|coming up) (?:for|with) (?:my )?taxes\b|\btax(?:es)? on autopilot\b|\bhow does jane (?:handle|run|do) my taxes\b/;
const BUSINESS_ASK =
  /\bs[- ]?corp(?:oration)?\b|\bqbi\b|\bqualified business income\b|\bpass[- ]?through\b|\bshould i (?:incorporate|form an llc|become an llc|elect)\b|\bllc\b.*\btax/;
const INHERITED_ASK =
  /\binherit(?:ed|ance)?\b|\bbeneficiary ira\b|\bstep(?:ped)?[- ]?up\b.*\bbasis\b|\bgift tax\b|\bform 709\b|\bannual (?:gift )?exclusion\b|\bestate tax\b|\b10[- ]year rule\b/;
const HEALTH_ASK =
  /\bpremium tax credit\b|\b(?:marketplace|obamacare|aca|healthcare\.gov)\b.*\b(?:subsid(?:y|ies)|credit|repay|pay (?:it )?back|tax)|\b(?:subsid(?:y|ies)|advance credit|aptc)\b.*\b(?:repay|pay (?:it )?back|owe|tax)|\bhsa\b.*\b(?:too much|over the limit|excess|limit|max(?:imum)?)\b|\b(?:put|contribut\w*) too much\b.*\bhsa\b|\bmedical (?:expenses|costs|bills)\b.*\b(?:deduct(?:ion|ions|ed|ing)?|tax\w*|write off)\b|\bdeduct(?:ion|ions|ed|ing)?\b.*\b(?:medical|dental|doctor|hospital)\b|\bmedical (?:expense )?deduction\b|\bform 8962\b/;
const DISASTER_ASK =
  /\bcasualty loss\b|\bdisaster (?:relief|loss|postpone\w*|extension|area)\b|\bfema\b|\b(?:hurricane|wildfire|fire|flood|tornado|storm|earthquake|disaster)\b.*\b(?:tax(?:es)?|irs|deadline|deduct(?:ion|ions|ed|ing)?|write off|more time|extension)\b|\b(?:tax(?:es)?|irs|deadline|deduct(?:ion|ions|ed|ing)?)\b.*\b(?:hurricane|wildfire|flood|tornado|storm|earthquake|disaster)\b/;
const RETIREMENT_ASK =
  /\birmaa\b|\bmedicare\b.*\b(?:surcharge|premiums? (?:go up|higher|more)|income)\b|\b(?:social security|ss benefits?)\b.*\b(?:tax(?:ed|es|able)?|withhold\w*|w-?4v)\b|\b(?:tax(?:ed|es|able)?)\b.*\bsocial security\b|\bwhich account\b.*\b(?:withdraw|draw|take)\b|\bwithdrawal order\b|\btax torpedo\b/;
const SET_COUNTY = /\bi live in ([a-z][a-z .'-]{1,30}?) county\b/;
const RETIRE_YEAR = /\b(?:plan|expect|want|hope|aim) to retire (?:in|by) (\d{4})\b/;
const PACK = /\btax(?:-| )?time pack\b|\btax pack\b|\byear-end pack\b/;

function stateCode(words: string): string | null {
  const w = words.trim().replace(/\.$/, "");
  const match = US_STATES.find((s) => s.name.toLowerCase() === w || s.code.toLowerCase() === w);
  return match?.code ?? null;
}

// The tax questions people really ask, in the words they use, each with the topic whose
// numbers answer it (src/lib/tax-decisions.ts). Checked first, so a direct question gets a
// direct answer and not a page's worth of figures.
const DECISIONS: readonly (readonly [DecisionTopic, RegExp])[] = [
  [
    "itemize",
    /\bshould i (?:itemi[sz]e|take the standard)|\bitemi[sz]e\b.*\b(?:or|vs\.?|versus)\b.*\bstandard\b|\bstandard\b.*\b(?:or|vs\.?|versus)\b.*\bitemi[sz]/,
  ],
  [
    "roth_conversion",
    /\bshould i\b.*\broth conversion|\b(?:is|would) a roth conversion\b|\bshould i convert\b.*\broth\b/,
  ],
  [
    "withholding",
    /\bshould i (?:adjust|change|raise|lower|increase|decrease|fix|update)\b.*\bwithholding\b|\bis my withholding (?:right|enough|too (?:high|low))\b|\bshould i (?:file|submit|change|fill out) (?:a )?(?:new )?w-?4\b/,
  ],
  [
    "estimated",
    /\b(?:do|should) i (?:need|have) to (?:pay|make) (?:quarterly|estimated)\b|\bdo i need (?:to pay )?estimated\b|\bshould i pay (?:quarterly|estimated)\b|\bdo i owe quarterly\b/,
  ],
  [
    "k401",
    /\bshould i (?:max(?:imi[sz]e)?(?: out)?|put more|contribute more|put more money)\b.*\b401/,
  ],
  [
    "ira",
    /\b(?:traditional|regular) ira (?:or|vs\.?|versus) (?:a )?roth\b|\b(?:traditional|regular) (?:or|vs\.?|versus) (?:a )?roth ira\b|\broth ira (?:or|vs\.?|versus) (?:a )?traditional\b|\broth (?:or|vs\.?|versus) (?:a )?traditional ira\b/,
  ],
  ["hsa", /\bshould i (?:open|get|start|use|have) (?:an? )?hsa\b/],
  [
    "property",
    /\b(?:is it worth|should i)\b.*\b(?:appeal|protest|contest)\w*\b.*\bproperty tax|\bshould i (?:appeal|protest)\b.*\b(?:assessment|property)/,
  ],
  [
    "harvest",
    /\bshould i sell\b.*\b(?:loss|losing|loser|losers)\b|\b(?:harvest|harvesting)\b.*\bloss/,
  ],
  [
    "donate_stock",
    /\b(?:donat\w*|give|giving)\b.*\b(?:stock|shares)\b.*\b(?:instead|rather|better)\b|\b(?:stock|shares)\b.*\binstead of (?:cash|money)\b/,
  ],
  [
    "home_office",
    /\bhome office\b.*\b(?:deduction|deduct|write[- ]?off|worth|claim)\b|\b(?:should i|can i) (?:take|claim|deduct)\b.*\bhome office\b/,
  ],
  [
    "owe",
    /\bhow much (?:will|would|do) i owe\b|\bhow much\b.*\b(?:tax(?:es)?|federal)\b.*\b(?:will|do|would|am) i\b.*\bowe\b|\bhow much (?:tax|taxes) (?:will|do|would) i owe\b|\bwill i owe (?:any )?(?:tax|taxes)\b(?!\s+(?:on|in|to|for|from)\b)|\bdo i owe (?:any )?(?:federal )?(?:tax|taxes)\b(?!\s+(?:on|in|to|for|from)\b)/,
  ],
  ["refund", /\bhow (?:big|much)\b.*\brefund\b|\b(?:will|am) i (?:get|getting) a refund\b/],
  [
    "refund_why",
    /\bwhy\b.*\b(?:refund|tax bill)\b.*\b(?:small|big|large|low|high|so)\b|\bwhy (?:is|am) my refund\b/,
  ],
  ["effective_rate", /\beffective (?:tax )?rate\b/],
  [
    "paid",
    /\bhow much\b.*\b(?:have i paid|did i pay|i(?:'ve| have) paid)\b.*\btax|\bhow much\b.*\b(?:federal )?tax(?:es)?\b.*\b(?:have i paid|did i pay|paid so far|been withheld)\b|\bhow much (?:federal )?tax (?:have|has)\b.*\b(?:i|been)\b.*\b(?:paid|withheld)\b/,
  ],
  [
    "deductions",
    /\bwhat (?:can|could|do) i (?:deduct|write off)\b|\bwhat (?:deductions|write[- ]?offs) (?:do|can) i\b/,
  ],
  [
    "setaside",
    /\bhow much\b.*\b(?:set aside|put aside|save)\b.*\b(?:for )?taxes?\b|\bhow much (?:tax|taxes)\b.*\b(?:set aside|put aside|save)\b/,
  ],
  [
    "est_due",
    /\bnext estimated\b|\bestimated (?:tax )?payments?\b.*\bdue\b|\bwhen (?:is|are|do)\b.*\bestimated\b/,
  ],
  ["must_file", /\bdo i (?:need|have) to file\b|\bam i required to file\b|\bmust i file\b/],
  [
    "k401_limit",
    /\bhow much can i (?:put|contribute|put in|save)\b.*\b401|\b401\s?\(?k\)? (?:limit|contribution limit)\b/,
  ],
  ["mortgage_interest", /\bmortgage interest\b.*\bdeduct|\bdeduct\w*\b.*\bmortgage interest\b/],
];

export function parseTaxIntent(text: string): TaxIntent | null {
  for (const [topic, pattern] of DECISIONS) {
    if (pattern.test(text)) return { kind: "tax", ask: "decide", topic };
  }
  if (FAMILY_ASK.test(text)) return { kind: "tax", ask: "family" };
  if (EQUITY_ASK.test(text)) return { kind: "tax", ask: "equity" };
  const retire = text.match(RETIRE_YEAR);
  if (retire) return { kind: "tax", ask: "retire_year", year: Number(retire[1]) };
  const county = SET_COUNTY.exec(text);
  if (county) return { kind: "tax", ask: "set_county", county: county[1].trim() };
  if (DISASTER_ASK.test(text)) return { kind: "tax", ask: "disaster" };
  if (RETIREMENT_ASK.test(text)) return { kind: "tax", ask: "retirement" };
  if (HEALTH_ASK.test(text)) return { kind: "tax", ask: "health" };
  if (INHERITED_ASK.test(text)) return { kind: "tax", ask: "inherited" };
  if (BUSINESS_ASK.test(text)) return { kind: "tax", ask: "business" };
  if (CALENDAR_ASK.test(text)) return { kind: "tax", ask: "calendar" };
  if (ACCOUNTANT_ASK.test(text)) return { kind: "tax", ask: "accountant" };
  if (PROPERTY_ASK.test(text)) return { kind: "tax", ask: "property" };
  if (YEARS_ASK.test(text)) return { kind: "tax", ask: "years" };
  if (IDENTITY_REJECTED.test(text)) return { kind: "tax", ask: "identity", sign: "efile_rejected" };
  if (IDENTITY_FORM.test(text)) return { kind: "tax", ask: "identity", sign: "unknown_form" };
  if (IDENTITY_LETTER.test(text)) return { kind: "tax", ask: "identity", sign: "irs_letter" };
  if (IDENTITY_ASK.test(text)) return { kind: "tax", ask: "identity", sign: null };
  if (NOTICE_ASK.test(text)) return { kind: "tax", ask: "notice" };
  if (!/^(?:tag|untag) /.test(text) && SIDE_INCOME.test(text))
    return { kind: "tax", ask: "side_income" };
  if (LAST_RETURN.test(text)) return { kind: "tax", ask: "last_return" };
  if (RECORDS_ASK.test(text)) return { kind: "tax", ask: "records" };
  if (HOME_ASK.test(text)) return { kind: "tax", ask: "home" };
  for (const [pattern, status] of FILING) {
    if (pattern.test(text)) return { kind: "tax", ask: "set_filing", status };
  }
  if (MARRIED.test(text)) return { kind: "tax", ask: "set_filing", status: null };
  const kids = KIDS.exec(text);
  if (kids) {
    const n = /^\d+$/.test(kids[1]) ? Number(kids[1]) : NUMBER_WORDS[kids[1]];
    if (n !== undefined) return { kind: "tax", ask: "set_kids", count: n };
  }
  const move = MOVE.exec(text);
  if (move && (move[1] || move[3])) {
    const to = stateCode(move[2])!;
    const from = move[1] ? stateCode(move[1]) : null;
    if (from !== to) {
      return {
        kind: "tax",
        ask: "move",
        from,
        to,
        month: move[3] ? MONTHS.indexOf(move[3]) + 1 : null,
        day: move[4] ? Number(move[4]) : null,
      };
    }
  }
  const work = WORK_STATE.exec(text);
  if (work) return { kind: "tax", ask: "work_state", state: stateCode(work[1] ?? work[2])! };
  const state = STATE.exec(text);
  if (state) {
    const code = stateCode(state[1]);
    if (code) return { kind: "tax", ask: "set_state", state: code };
  }
  const tag = TAG.exec(text);
  if (tag)
    return { kind: "tax", ask: "tag", target: tag[1].trim(), tag: TAG_WORDS[tag[2]] ?? "work" };
  const untag = UNTAG.exec(text);
  if (untag) return { kind: "tax", ask: "tag", target: untag[1].trim(), tag: null };
  if (PACK.test(text)) return { kind: "tax", ask: "pack" };
  if (PLAN.test(text)) return { kind: "tax", ask: "plan" };
  if (GIVING_ASK.test(text)) return { kind: "tax", ask: "giving" };
  if (STANDARD.test(text)) return { kind: "tax", ask: "standard_deduction" };
  if (INVESTMENT_TAX.test(text)) return { kind: "tax", ask: "investments" };
  if (REFUND_ASK.test(text)) return { kind: "tax", ask: "refund" };
  if (FILE.test(text)) return { kind: "tax", ask: "file" };
  if (WITHHOLDING.test(text)) return { kind: "tax", ask: "withholding" };
  if (SAVINGS.test(text)) return { kind: "tax", ask: "savings" };
  const miles = MILES_ADD.exec(text);
  if (miles) return { kind: "tax", ask: "miles", miles: Number(miles[1].replaceAll(",", "")) };
  if (MILEAGE.test(text)) return { kind: "tax", ask: "miles", miles: null };
  if (HOME_OFFICE.test(text)) return { kind: "tax", ask: "home_office" };
  if (SET_ASIDE.test(text)) return { kind: "tax", ask: "set_aside" };
  if (QUARTERLY_ASK.test(text)) return { kind: "tax", ask: "quarterly" };
  if (BRACKET.test(text)) return { kind: "tax", ask: "bracket" };
  if (STATES_ASK.test(text)) return { kind: "tax", ask: "states" };
  if (ESTIMATE.test(text) || (OWE.test(text) && TAX_WORD.test(text))) {
    return { kind: "tax", ask: "estimate" };
  }
  if (FORMS.test(text)) return { kind: "tax", ask: "forms" };
  if (TAGS.test(text)) return { kind: "tax", ask: "tags" };
  if (DONATIONS.test(text)) return { kind: "tax", ask: "tag_total", tag: "donation" };
  const total = TAG_TOTAL.exec(text);
  if (total) return { kind: "tax", ask: "tag_total", tag: TAG_WORDS[total[1]] };
  if (PROFILE.test(text)) return { kind: "tax", ask: "profile" };
  return null;
}
