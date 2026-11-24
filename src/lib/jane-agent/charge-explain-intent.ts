// "Why did I pay $100 to Vercel?", "why was Vercel so high", "what is this $100 Vercel charge", "why
// did Vercel charge me so much", "why did my Netflix go up" (founder 11-24): a question about one
// merchant's charge, which the charge explanation answers (./charge-explain.ts). Only with a name
// there: with none ("why was I charged $34?") the amount's own answer (./replies-fees.ts) is the
// reply, and a bank fee or interest is that answer's too. Read from the normalised text.
//
// Two stages, so no one else's question is taken: "early" is the wordings the charge's own answers
// already claimed (a charge by its amount, "what is this … charge"), read before them; "late" is
// what nothing else claimed ("why was Vercel so high" was unknown), read after the rest. "Why did X go
// up" is read where the price change is (./intents.ts), after the mortgage, insurance and the rest.

export type ChargeExplainAsk = { target: string; amountCents: number | null; high: boolean };
export type ChargeExplainStage = "early" | "late";

const AMOUNT = "\\$([\\d,]+(?:\\.\\d{1,2})?)";
const AMOUNT_ANYWHERE = new RegExp(AMOUNT);
// Why I paid, or was charged, something to someone.
const WHY_PAID =
  /^why (?:did|do|was|am|were|have|had) (?:i|we) (?:get |getting |been )?(?:pay(?:ing)?|paid|charged|billed)\b(.*)$/;
const SO_HIGH =
  /^why (?:was|is|were|are) (?:my |the |our )?(.+?)(?: (?:bill|charge|payment|invoice|subscription))? (?:so |this month |last month |this time |that |a lot |much )*(?:high|expensive|much|big|more|higher|bigger|steep|pricey)\b/;
// "What was the Nelnet charge?" and "what was the $14 Nelnet charge?" stay the charge's own answers
// (./replies-money-moves.ts, ./replies-fees.ts): only "this" or "that" charge, or one said by who
// it's from, is explained.
const WHAT_IS_THIS = new RegExp(
  `^what(?:'s| is| was) (?:(?:this|that) (?:${AMOUNT} )?(.+?) (?:charge|payment|invoice|bill)|(?:this|that|the) (?:${AMOUNT} )?(?:charge|payment) (?:from|by|at|to|for) (.+?))(?: on .+)?$`,
);
const CHARGED_ME =
  /^why (?:did|does|has|have|is|was) (?:my |the |our )?(.+?) (?:charg(?:e|ed|ing) (?:me|us)|bill(?:ed|ing)? (?:me|us))\b/;

// Words that make it something else: a fee or interest, or no name at all.
const NOT_A_NAME =
  /^(?:every|each|so|this|that|it|again|twice|monthly|yearly|weekly|a|an|extra|more|much|too|there|these|those|something|someone|anything|nothing|my bank|the bank|bank|them)\b/;
// A fee or interest anywhere in the question is the fee's answer (./replies-fees.ts), whoever charged it:
// "why did Chase charge me $34 in overdraft fees" names Chase and a fee.
const FEE_WORDS = /\b(?:fees?|interest|overdraft|nsf|penalty|penalties)\b/;
// APR, but not "Apr 20" or "Apr. 20th" (April, which the day parser reads): a month abbreviation is
// followed by its day, and "APR 20%" is a rate.
const APR = /\bapr\b(?!\.?\s+\d{1,2}(?:st|nd|rd|th)?\b(?!\s*%))/;
const mentionsFee = (text: string) => FEE_WORDS.test(text) || APR.test(text);

const MONTHS = "jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec";

const dollars = (text: string) => {
  const found = AMOUNT_ANYWHERE.exec(text)?.[1];
  const cents = found ? Math.round(Number(found.replace(/,/g, "")) * 100) : null;
  return cents !== null && cents > 0 ? cents : null;
};

// The merchant named in a question's words, or null when they name none.
export function merchantIn(raw: string | undefined): string | null {
  if (!raw) return null;
  // Trimmed first: what a pattern captures starts with its space (" my netflix bill"), and the
  // prefixes come off only at the start.
  const cleaned = raw
    .trim()
    .replace(new RegExp(AMOUNT, "g"), " ")
    .replace(new RegExp(` on (?:${MONTHS})[a-z]*\\.? \\d{1,2}(?:st|nd|rd|th)?\\b.*$`), "")
    .replace(/ on \d{1,2}\/\d{1,2}\b.*$/, "")
    .replace(/\b(?:so much|that much|too much|so high|a lot)\b/g, " ")
    .replace(/^\s*(?:to|by|at|for|from|with)\s+/, "")
    .replace(/\s+(?:this month|last month|this time|recently|lately|today|yesterday)\s*$/, "")
    .replace(/^(?:(?:my|the|our|a|an|that|this) )+/, "")
    .replace(
      /(?:^| )(?:subscriptions?|membership|bill|plan|account|charges?|service|payments?|invoice)$/,
      "",
    )
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned || cleaned.length > 40 || NOT_A_NAME.test(cleaned) || mentionsFee(cleaned)) {
    return null;
  }
  return cleaned;
}

export function parseChargeExplain(
  text: string,
  stage: ChargeExplainStage,
): ChargeExplainAsk | null {
  if (mentionsFee(text)) return null;
  const much = /\b(?:so much|that much)\b/.test(text);
  const amount = dollars(text);
  const paid = WHY_PAID.exec(text);
  if (paid) {
    const target = merchantIn(paid[1]);
    return target && (amount !== null) === (stage === "early")
      ? { target, amountCents: amount, high: much }
      : null;
  }
  const high = SO_HIGH.exec(text);
  if (high) {
    const target = merchantIn(high[1]);
    return stage === "late" && target ? { target, amountCents: amount, high: true } : null;
  }
  const what = WHAT_IS_THIS.exec(text);
  if (what) {
    const target = merchantIn(what[2] ?? what[4]);
    const given = what[1] ?? what[3];
    return stage === "early" && target
      ? { target, amountCents: given ? dollars(`$${given}`) : null, high: false }
      : null;
  }
  const charged = CHARGED_ME.exec(text);
  if (charged) {
    const target = merchantIn(charged[1]);
    return target && (amount !== null) === (stage === "early")
      ? { target, amountCents: amount, high: much }
      : null;
  }
  return null;
}
