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
      if (size === 1 && gram[0].length < 4) continue;
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
    const matching = named
      .filter(
        (n) => n.names.includes(` ${gram} `) || (gram.includes(" ") && n.names.includes(joined)),
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
  // "Spend for that earning" isn't a category, and saying so answers nothing.
  if (reply.body.includes(SPENDING_NOT_FOUND)) return false;
  const body = reply.body.toLowerCase();
  return payees.every((p) => body.includes(p.name.toLowerCase()));
}

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
