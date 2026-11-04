// Real accounts never get advice (CLAUDE.md), and the guardrail only reads what Claude wrote: the
// cards and messages written by hand reach people without it. Its word lists can't read them
// either, since "Your 401(k) funds cost $640 a year" is a fact a real account may see. So this asks
// the narrower question: does a sentence about taxes, investing, insurance or a loan tell the
// person what to do with their money? What it catches is left out for them, whoever wrote it.

const MONEY_TOPIC =
  /\b(?:tax(?:es|ed|able)?|deductions?|itemi[sz]\w*|write[- ]?offs?|w-4|401\(?k\)?|403\(?b\)?|roth|hsa|fsa|529|stocks?|shares?|bonds?|(?<!emergency )funds?|etfs?|t-bills?|treasur(?:y|ies)|annuit(?:y|ies)|brokerage|invest\w*|crypto|portfolio|retirement|conversions?|withdrawals?|umbrella|insurance|cover(?:age)?|polic(?:y|ies)|premiums?|refinanc\w*|consolidat\w*|loans?|mortgage)\b|\bIRAs?\b/i;

const MOVES =
  "take|put|set aside|stop|start(?!\\s+with\\b)|move|sell|buy|convert|contribute|max|switch|swap|roll|rebalance|invest|claim|deduct|write off|itemi[sz]e|amend|withdraw|empty|spread|add(?!\\s+(?:your|it|them|that|another|someone|rsus|the (?:people|deductible)|a policy|a card|a loan|a co-signed)\\b)|raise|lower|increase|reduce|cut|open an?|consolidate|refinance|shop|withhold";

// The move as a command: at the start of a sentence, or of a clause after ":", ";" or "then".
// "Move my tax deadlines" is the person's own button, deadlines "move to May" is news, moving a
// bill's due date moves no money, "Open Taxes" is a page, and "Add your policy" or "Add it on your
// insurance page" asks for what's on file.
const COMMAND = new RegExp(
  `(?:^|[:;]\\s+|\\bthen\\s+)(?:${MOVES})\\b(?!\\s+(?:my|to)\\b)(?![^.!?]*\\bdue date\\b)`,
  "i",
);
// The move as a recommendation: "you should sell", "ask whoever does your return to itemize".
const RECOMMENDS = new RegExp(
  `\\b(?:you should|you(?:'|’)?d (?:want|need) to|you need to|you must|you (?:could|can|may|might)|i(?:'|’)?d|ask [^.!?]{0,40} to)\\s+(?:\\w+\\s+)?(?:${MOVES})\\b`,
  "i",
);
// What the move is worth or what to fix: "itemizing saves about", "worth itemizing", "keep this
// year's income under", "fix it in your draft before you file".
const SELLS_THE_MOVE =
  /\b(?:itemi[sz]ing|converting|selling|switching|rolling)\b[^.!?]{0,40}\b(?:saves?|would save|cuts?|lowers?|worth)\b|\bworth (?:itemi[sz]ing|converting|selling|switching|rolling)\b|\bkeep\b[^.!?]{0,40}\b(?:income|withdrawals|conversions)\b[^.!?]{0,20}\bunder\b|\bfix\b[^.!?]{0,60}\b(?:return|draft)\b/i;

export function tellsThemToAct(text: string): boolean {
  return text
    .split(/(?<=[.!?])\s+|\n+/)
    .map((sentence) => sentence.trim())
    .some(
      (sentence) =>
        (MONEY_TOPIC.test(sentence) && (COMMAND.test(sentence) || RECOMMENDS.test(sentence))) ||
        SELLS_THE_MOVE.test(sentence),
    );
}
