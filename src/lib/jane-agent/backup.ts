import { normalizeMerchant } from "@/data-sources/merchant";
import { loadTransactionsBetween } from "@/detection/engine";
import type { PrismaClient } from "@/generated/prisma/client";
import { formatCents } from "@/lib/money";
import type { Intent } from "./intents";
import { SPENDING_NOT_FOUND, type Reply } from "./replies";

// The backup for when Claude can't answer (blocked, failed, over budget): founder 10-30, "How much
// tax will I have to pay because of Lucid Trading? How much did I earn from them, how much did I
// actually spend for that earning" got "I couldn't find spending on "earning"", an answer to a
// question nobody asked. A rules answer stands in only when the rules read the whole question:
// every part answered, a category that exists, and whatever the person named in the answer.
// Otherwise Jane says it couldn't write the answer and gives what it can see for the names the
// person typed (what came in from them and what went out to them), never an unrelated breakdown.

// Asking Jane to help hide money, forge or get around something: when Claude's own refusal
// couldn't be shown, a short refusal that needs no model. Someone it was done to ("I got hacked",
// "is this charge fraud?", "my ex forged my signature") is asking for help, not refused (11-01):
// the words that both sides use count only after an ask to do it ("how do I", "help me").
const ALWAYS_UNSAFE =
  /\b(?:hide (?:money|income|assets|cash)|launder\w*|evad(?:e|ing) (?:tax|taxes|the irs)|tax evasion|dodg(?:e|ing) (?:my |the |paying )*(?:tax|taxes|child support|irs)|never paying taxes|commit(?:ting)? (?:\w+ )?fraud|structur\w* (?:my |the )?deposits|fake (?:a |an |my )(?:id|document|signature|receipt|paystub|pay stub)|^(?:write|make|create) (?:me )?(?:a |an )?fake\b|(?:damage|fire|crash|accident)\b[^.?!]{0,30}\bon purpose|i paid when i didn'?t|use my \w+'?s social security|admin password|api key|dump the database|(?:everyone|another user|other users)'?s? data|access (?:someone|somebody) else'?s?)\b/i;
// The harm as the thing the person wants to do: the verb with what it's done to ("hack into",
// "steal my brother's card", "scam people"), never what was done to them ("hacked", "scammed",
// "scammers", "a scam call": night debugger 11-01).
const OBJECT =
  "(?:a|an|my|his|her|their|our|the|this|that|someone|somebody|people|them|him|me|into|from|\\w+'s)";
const HARM_VERB = [
  `hack ${OBJECT}`,
  `steal ${OBJECT}`,
  "steal (?:money|cash|cards?|identit(?:y|ies))",
  `forge ${OBJECT}`,
  "cheat (?:on|the|my|his|her|their|someone|people)",
  `defraud ${OBJECT}`,
  "scam (?:people|someone|somebody|them|him|her|customers|my|his|her|their|the|\\w+'s)",
  "bypass (?:the |a |my |their |his |her |\\w+'s )?(?:bank's )?(?:two[- ]factor|2fa|security|verification|id check|identity check|login|password|fraud (?:checks?|alerts?)|kyc)",
  "lie (?:to|on|about)",
  "break into",
  // Writing it up, or spying on someone they know (11-03, from the unsafe scenarios).
  "a fake (?:id|document|signature|receipt|paystub|pay stub|invoice|name)",
  "fake (?:a |an |my )?(?:id|document|signature|receipt|paystub|pay stub|invoice)",
  "(?:a |an )?ponzi",
  "cash (?:a |an |this |the )?stolen",
  "read (?:my )?(?:partner|wife|husband|spouse|girlfriend|boyfriend|ex)'?s",
].join("|");
const ASK_TO = new RegExp(
  `\\b(?:how (?:do|can|could|would|should|might) (?:i|we|you)|help me|tell me how to|can you|could you|will you|teach me|show me|i (?:want|need|plan|'m going|am going) to|is there a way to|way to|best way to|make me)\\b[^.?!]{0,40}?\\b(?:${HARM_VERB})\\b`,
  "i",
);
// Someone reporting or checking one of these is on the right side of it.
const REPORTING = /\b(?:report|spot|dispute|recogni[sz]e|tell if|know if)\b/i;
export function unsafeRequest(text: string): boolean {
  return ALWAYS_UNSAFE.test(text) || (ASK_TO.test(text) && !REPORTING.test(text));
}
export const UNSAFE_TEXT =
  "I can't help with that. I'm glad to help with your spending, bills, savings or taxes the honest way.";

// A new question inside the message: "?", ";", a new line, or ", how much…" / "and what…".
const QUESTION_WORD =
  "(?:how|what|when|where|why|which|who|can|could|do|does|did|is|are|should|will|would)\\b";
const PARTS = new RegExp(
  `\\?+\\s*|[;\\n]+|,\\s*(?=(?:and\\s+)?${QUESTION_WORD})|\\s+and\\s+(?=${QUESTION_WORD})`,
  "i",
);

// The questions in a message, each of at least two words. Pure.
export function questionParts(text: string): string[] {
  return text
    .split(PARTS)
    .map((p) => p.trim())
    .filter((p) => p.split(/\s+/).length >= 2);
}

// Words that name no one: a payee the person typed starts with a word that isn't one of these,
// and goes on with words that aren't the joining ones ("Lucid Trading", never "lucid because").
const JOINING =
  "a an the i me my mine we our you your them they their it its this that these those he she " +
  "him her his of on in at to for from by with about because as and or but so if then than " +
  "how what when where why which who much many can could do does did is are was were be been " +
  "should will would have has had get got actually really just also still ever";
const FUNCTION = new Set(JOINING.split(" "));
const COMMON = new Set(
  (
    JOINING +
    " tax taxes taxed taxable income money pay paid pays payment payments payout payouts fee fees " +
    "cost costs spend spent spending earn earned earning earnings make making made side gig work " +
    "job business expense expenses deduct deduction deductions claim file filing owe owed refund " +
    "transfer transfers deposit deposits credit debit card cards bank account accounts interest " +
    "trading trade trades firm company month months year years week weeks today total net all " +
    "last next far since until per lose losing lost save saving savings buy bought sell sold"
  ).split(" "),
);

// On their own these are everyday words that are also part of a merchant's name: "my whole savings"
// isn't Whole Foods, though "whole foods" is, and "cash" isn't Cash App.
const NOT_A_NAME_ALONE = new Set(
  "whole cash loan loans check checks insurance report stolen legal free government checking overdraft charge charges store market monthly thank thanks protection student".split(
    " ",
  ),
);

type Row = { date: string; amountCents: number; description: string; merchantName: string | null };
export type PayeeTotals = {
  name: string;
  inCents: number;
  inCount: number;
  outCents: number;
  outCount: number;
};

// Every way a transaction names its payee, lower case, words only.
function namesOf(row: Row): string {
  return [row.merchantName ?? "", normalizeMerchant(row.description)?.key ?? "", row.description]
    .join(" | ")
    .toLowerCase()
    .replace(/[^a-z0-9&' |]+/g, " ");
}

const size = (gram: string) => gram.split(" ").length;
const titleCase = (s: string) => s.replace(/\b[a-z]/g, (c) => c.toUpperCase());

// The payees the person named in their question that their own transactions have, with what came
// in from each and what went out to each. Up to two, longest name first. Pure.
export function namedPayees(text: string, rows: readonly Row[]): PayeeTotals[] {
  const words = text
    .toLowerCase()
    .replace(/[^a-z0-9&' ]+/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  const grams: string[] = [];
  for (let size = 3; size >= 1; size -= 1) {
    for (let i = 0; i + size <= words.length; i += 1) {
      const gram = words.slice(i, i + size);
      if (COMMON.has(gram[0]) || gram.slice(1).some((w) => FUNCTION.has(w))) continue;
      if (size === 1 && (gram[0].length < 4 || NOT_A_NAME_ALONE.has(gram[0]))) continue;
      grams.push(gram.join(" "));
    }
  }
  const named = rows.map((r) => ({ row: r, names: ` ${namesOf(r)} ` }));
  const found: PayeeTotals[] = [];
  for (const gram of grams) {
    if (found.length >= 2) break;
    if (found.some((f) => f.name.toLowerCase().includes(gram))) continue;
    // "lucid trading" is also "LUCIDTRADING.COM".
    const joined = ` ${gram.replaceAll(" ", "")}`;
    // One word has to start the name: "market" isn't Whole Foods Market (11-03).
    const startsName = (names: string) =>
      names.startsWith(` ${gram} `) || names.includes(`| ${gram} `);
    const matching = named
      .filter((n) =>
        size(gram) === 1
          ? startsName(n.names)
          : n.names.includes(` ${gram} `) || n.names.includes(joined),
      )
      .map((n) => n.row);
    if (matching.length === 0) continue;
    const ins = matching.filter((r) => r.amountCents < 0);
    const outs = matching.filter((r) => r.amountCents > 0);
    found.push({
      name: titleCase(gram),
      inCents: -ins.reduce((n, r) => n + r.amountCents, 0),
      inCount: ins.length,
      outCents: outs.reduce((n, r) => n + r.amountCents, 0),
      outCount: outs.length,
    });
  }
  return found;
}

// Whether a rules answer answers this question, all of it: the whole message parsed as one
// question it understands (or each part answered on its own), a spending category that exists,
// and every payee the person named in the answer. Pure.
export function rulesCoverQuestion({
  text,
  intent,
  reply,
  partsAnswered,
  payees,
}: {
  text: string;
  intent: Intent;
  reply: Reply;
  // How many parts the rules answered one by one (splitQuestions), 0 when they read it whole.
  partsAnswered: number;
  payees: readonly PayeeTotals[];
}): boolean {
  const parts = questionParts(text).length;
  if (partsAnswered > 0 ? partsAnswered < parts : parts > 1) return false;
  if (intent.kind === "unknown") return false;
  if (SOMEONE_ELSES.test(text) || NOT_A_LOOKUP.test(text)) return false;
  if (NAMED_THINGS.some(([asked, answered]) => asked.test(text) && !answered.test(reply.body))) {
    return false;
  }
  // "Spend for that earning" isn't a category, and saying so answers nothing.
  if (reply.body.includes(SPENDING_NOT_FOUND)) return false;
  const body = reply.body.toLowerCase();
  return payees.every((p) => body.includes(p.name.toLowerCase()));
}

// What the rules read as a lookup of the person's own numbers but isn't one: someone else's money
// ("tell me my coworkers salary" got their own payday), and what to do rather than what they have
// ("sue my landlord for me" got their home equity). Claude can answer these; the rules can't (11-03).
const SOMEONE_ELSES =
  /\b(?:coworkers?|co-workers?|boss|neighbou?rs?|friends?|ex)(?:'?s)?\b[^.?!]{0,30}\b(?:salary|makes?|earns?|income|spends?|address|broke|account|transactions?|data)\b|\b(?:wife|husband|partner|spouse|girlfriend|boyfriend|mom|mother|dad|father|kid|son|daughter)'?s?\b[^.?!]{0,30}\b(?:transactions?|texts?|bank|login|password|social security)\b/i;
const NOT_A_LOOKUP =
  /\b(?:sue|lawsuit|lawyer|write my will|guarantee(?:d)? (?:me|way)|promise|social security number|as a dependent|sell (?:all )?my (?:stocks|investments|funds|portfolio)|how long will my money last)\b|^(?:get me a|book a)\b/i;
// Something the person named has to be in the answer, like a payee: "should i get a roth ira" got
// their untaxed gains, "is my annuity worth it" their advisory fees, "should i pay my card or put
// money in my 401k" that Jane can't pay bills, "call my landlord" their home equity (11-03).
const NAMED_THINGS: readonly (readonly [RegExp, RegExp])[] = [
  [/\broth\b/i, /\broth\b/i],
  [/\bannuit/i, /\bannuit/i],
  [/\bwhole life\b/i, /\bwhole life\b/i],
  [/\bhsa\b/i, /\bhsa\b/i],
  [/\b529\b/, /\b529\b|college/i],
  [/\brmd\b/i, /\brmd\b|required minimum/i],
  [/\b401\(?k\)?/i, /\b401\(k\)/i],
  [/\blandlord\b/i, /\blandlord\b/i],
  [/\bmortgage\b/i, /\bmortgage\b|\bhome loan\b|refinanc/i],
  [/\bcollege\b/i, /\bcollege\b|\b529\b/i],
];

// Taxes, deductions, filing: the part Jane can't advise on for a real account.
const TAX_QUESTION = /\b(?:tax\w*|deduct\w*|write[- ]?off|irs|1099|w-?2|file|filing)\b/i;
const COULDNT = "I couldn't write a full answer to that just now.";

// What Jane can say for sure when it couldn't write the answer: the payees' totals this year.
export function payeeFactsReply(
  text: string,
  payees: readonly PayeeTotals[],
  { limitNote }: { limitNote?: string } = {},
): Reply {
  const lines = payees.map((p) => {
    const net = p.inCents - p.outCents;
    const inPart =
      p.inCount > 0
        ? `${formatCents(p.inCents)} came in from ${p.name} (${p.inCount} ${p.inCount === 1 ? "payment" : "payments"})`
        : `nothing came in from ${p.name}`;
    const outPart =
      p.outCount > 0
        ? `${formatCents(p.outCents)} went out to it (${p.outCount} ${p.outCount === 1 ? "charge" : "charges"})`
        : "nothing went out to it";
    const netPart =
      p.inCount > 0 && p.outCount > 0
        ? `, so ${formatCents(Math.abs(net))} ${net >= 0 ? "more in than out" : "more out than in"}`
        : "";
    return `This year in your accounts, ${inPart} and ${outPart}${netPart}.`;
  });
  const tax = TAX_QUESTION.test(text) ? " I can't tell you what to file or deduct." : "";
  return {
    body: `${limitNote ?? COULDNT} ${lines.join(" ")}${tax}`,
    actions: [],
    refs: { topic: { kind: "asked", target: payees[0].name } },
  };
}

// The person's transactions since January 1, for the payees they named.
export async function payeesInQuestion(
  userId: string,
  text: string,
  { client, now }: { client: PrismaClient; now: Date },
): Promise<PayeeTotals[]> {
  const to = now.toISOString().slice(0, 10);
  const rows = await loadTransactionsBetween(userId, {
    client,
    from: `${to.slice(0, 4)}-01-01`,
    to,
  }).catch(() => []);
  return namedPayees(text, rows);
}
