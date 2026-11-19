import Anthropic from "@anthropic-ai/sdk";
import { MODEL_PRICES_CENTS } from "@/config/answer-checks";
import { GMAIL_KINDS, GMAIL_LIMITS, GMAIL_READER_MODEL, type GmailKind } from "@/config/gmail";
import { anthropic, finishedText, llmEnabled } from "@/lib/anthropic";
import { DAY_MS, isoDay } from "@/lib/dates";
import { log } from "@/lib/log";
import { parseMoneyToCents } from "@/lib/money";
import { UNTRUSTED_TEXT_RULE } from "@/lib/untrusted-text";

// Claude reads one email that passed the screen (./screen.ts) into three facts: what kind of money
// email it is, the amount and the day. The email was written by someone else
// (src/lib/untrusted-text.ts) and may tell Claude anything, so nothing here depends on Claude having
// listened: the kind must be one on the list, the amount must be a number written in the email it
// was given, and the day must fall near the day it arrived. No words of Claude's leave this file,
// only an entry from a list, a whole number and a date; so a hostile email can at most get itself
// listed as what it says it is. Never log the email or the answer.

type MoneyMail = {
  // The day the email arrived, "YYYY-MM-DD".
  received: string;
  // The sender's domain, as Google checked it.
  from: string;
  // Both cleaned and cut by the caller (./text.ts).
  subject: string;
  body: string;
};

// Why Claude couldn't be asked: a code of ours for the team, or the API's status as a number. Never
// anyone's words.
type LaterReason = "OFF" | "CONNECTION" | "ERROR" | `${number}`;

type MailReading =
  | {
      outcome: "read";
      fact: { kind: GmailKind; amountCents: number | null; occursOn: Date | null };
    }
  // Not a money email, or it names no amount and no day: nothing is kept.
  | { outcome: "none" }
  // Claude gave no answer for this one email. It is skipped; the next may be fine.
  | { outcome: "unread" }
  // Claude can't be asked right now. Nothing is wrong with the email: it is read later.
  | { outcome: "later"; reason: LaterReason };

const SYSTEM = `You read one email a company sent to a customer, and say whether it is about the customer's money, using only what the email says.

kind:
- "receipt": a payment was made, or an order was paid for.
- "bill": an amount is owed or will be collected (a bill, an invoice, a statement, a payment that is due).
- "renewal": a subscription, a plan or a policy renews, or a free trial ends and a charge follows.
- "price_change": the price of something the customer already pays for is changing.
- "refund": money is coming back to the customer.
- "none": anything else, including advertising, shipping updates and account notices, and anything you aren't sure about.

amount: the amount in US dollars, written with digits and a point only, like 1234.56. For a receipt or a bill, the total. An empty string when the email states no amount, or the amount isn't in US dollars.
date: the day the email is about, as YYYY-MM-DD: the day it was paid, is due, renews, changes or was refunded. When the email gives a day without its year, work the year out from the day the email arrived. An empty string when the email states no day.

The email comes as JSON: "from" is the sender's domain and "received" is the day it arrived. In its text, "[link]", "[address]" and "[number]" stand for a link, an email address and a long number that were taken out, and "[...]" for a part that was left out.

${UNTRUSTED_TEXT_RULE}`;

const SCHEMA = {
  type: "object",
  properties: {
    kind: { type: "string", enum: [...GMAIL_KINDS, "none"] },
    amount: { type: "string" },
    date: { type: "string" },
  },
  required: ["kind", "amount", "date"],
  additionalProperties: false,
};

// ANTHROPIC_GMAIL_MODEL names another model only when its price is listed. One that isn't would be
// held at the dearest price there is, and a few emails would use up a person's day for everything
// else Claude does for them.
function readerModel(): string {
  const named = process.env.ANTHROPIC_GMAIL_MODEL?.trim();
  return named && Object.hasOwn(MODEL_PRICES_CENTS, named) ? named : GMAIL_READER_MODEL;
}

const whitespace = (c: string | undefined): boolean =>
  c === " " || c === "\n" || c === "\r" || c === "\t";
const letter = (c: string | undefined): boolean =>
  c !== undefined && ((c >= "a" && c <= "z") || (c >= "A" && c <= "Z"));

// The letters that end just before `end`, as written.
function wordBefore(text: string, end: number): string {
  let start = end;
  while (start > 0 && letter(text[start - 1])) start--;
  return text.slice(start, end);
}

// The letters that start at `start`.
function wordAt(text: string, start: number): string {
  let end = start;
  while (letter(text[end])) end++;
  return text.slice(start, end);
}

// Another country's money, by its code, its sign, or the letters it puts before a dollar sign. No
// code here is also an English word, since one is matched in any case.
const OTHER_CODES = new Set(
  "CAD AUD NZD MXN HKD SGD EUR GBP JPY CNY RMB INR KRW CHF BRL SEK NOK DKK PLN ZAR".split(" "),
);
const OTHER_SIGNS = new Set(["£", "€", "¥", "₹", "₩", "₱", "₽", "₺", "₪"]);
const OTHER_DOLLARS = new Set(["CA", "C", "A", "AU", "MX", "NZ", "HK", "S", "R", "NT"]);

// What may stand between a number and its currency mark without hiding it.
const between = (c: string | undefined): boolean =>
  c !== undefined && (whitespace(c) || "(-+:)".includes(c));

// Whether the currency mark next to a number, on either side, is another country's: "CA$15.49",
// "CAD$15.49", "CAD $15.49", "15.49 CAD", "Total (EUR): 15.49", "€15". Spaces, a sign, a colon and
// brackets between them don't hide it. "$15.49 CAD" is Canadian, so either side is enough.
function otherCurrency(text: string, start: number, end: number): boolean {
  let before = start - 1;
  while (before >= 0 && between(text[before])) before--;
  const mark = text[before];
  if (OTHER_SIGNS.has(mark)) return true;
  if (mark === "$") {
    const joined = wordBefore(text, before);
    if (OTHER_DOLLARS.has(joined) || OTHER_CODES.has(joined.toUpperCase())) return true;
    // A code set apart from its dollar sign. One or two letters set apart are a word ("Plan A
    // $15", "tax CA $1.20"), not a country.
    let gap = before - 1;
    while (gap >= 0 && between(text[gap])) gap--;
    if (gap < before - 1 && OTHER_CODES.has(wordBefore(text, gap + 1).toUpperCase())) return true;
  }
  if (OTHER_CODES.has(wordBefore(text, before + 1).toUpperCase())) return true;
  let after = end;
  while (whitespace(text[after]) || text[after] === "(" || text[after] === ")") after++;
  return OTHER_SIGNS.has(text[after]) || OTHER_CODES.has(wordAt(text, after).toUpperCase());
}

// A number with whatever joins it to more digits: "1,234.56", "2026-11-18", "10:32", "15,49".
const JOINED_DIGITS = /\d[\d.,:/-]*\d|\d/g;

// Every amount written in a text, in cents. A number counts when all of it, with what joins it, is
// a plain amount: "15.49" and "1,234.56" are, and "$15,49", a date, a time and a phone number
// aren't. It doesn't count as "2k" or "2M", as a percentage, as dollars whose cents were set apart
// ("$15 49" and "$15 .49" are none of 15, 15.49, 49 or 0.49), or beside another country's currency.
function amountsWritten(text: string): Set<number> {
  const amounts = new Set<number>();
  // Where the cents of a figure set apart from its dollars begin.
  let setApart = -1;
  for (const found of text.matchAll(JOINED_DIGITS)) {
    if (found.index === setApart) continue;
    const end = found.index + found[0].length;
    const before = text.slice(Math.max(0, found.index - 2), found.index);
    // After a point of its own, ".49" is 49 cents and never 49 dollars. A row of dots that leads to
    // a total isn't such a point.
    const start = /(?:^|[^.])\.$/.test(before) ? found.index - 1 : found.index;
    const number = text.slice(start, end);
    const cents = parseMoneyToCents(number);
    if (cents === null || "kKmM%".includes(text[end] ?? " ")) continue;
    const wholeDollars = !number.includes(".") && /\$ ?$/.test(before);
    const apart = wholeDollars && /^ \.?(?=\d{2}(?!\d|[.,]\d))/.exec(text.slice(end, end + 6));
    if (apart) {
      setApart = end + apart[0].length;
      continue;
    }
    if (otherCurrency(text, start, end)) continue;
    amounts.add(cents);
  }
  return amounts;
}

// The amount Claude gave, kept only when it is one the email itself states.
function amountOf(answer: unknown, mail: MoneyMail): number | null {
  const cents = typeof answer === "string" ? parseMoneyToCents(answer) : null;
  if (cents === null || cents <= 0 || cents > GMAIL_LIMITS.amountMostCents) return null;
  return amountsWritten(`${mail.subject}\n${mail.body}`).has(cents) ? cents : null;
}

// "2026-11-18" as that day at midnight UTC. Null for any other writing, and for a day that doesn't
// exist: February 30 either isn't a date at all or comes back as March 2.
function dayOf(text: unknown): Date | null {
  if (typeof text !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
  const date = new Date(`${text}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && isoDay(date) === text ? date : null;
}

// The day Claude gave, kept only near the day the email arrived: a receipt is for a day just past,
// a renewal for one in the year ahead.
function dateOf(answer: unknown, received: string): Date | null {
  const day = dayOf(answer);
  const arrived = dayOf(received);
  if (!day || !arrived) return null;
  const days = (day.getTime() - arrived.getTime()) / DAY_MS;
  return days >= -GMAIL_LIMITS.dateBackDays && days <= GMAIL_LIMITS.dateAheadDays ? day : null;
}

// Why Claude gave no answer. An answer that didn't begin in time is that email's own trouble.
// Anything else means Claude can't be asked at all, and says nothing about the email: a busy or
// failing API, an answer that began and didn't end in time, this person's or everyone's limit, a
// wrong key, billing or model name, and a 400 or a 413 as well. Every request is cut to a size the
// API takes, so no one email brings either about: they mean the request itself is wrong (a setting,
// a model), for every email alike.
function notAnswered(error: unknown): MailReading {
  if (error instanceof Anthropic.APIConnectionTimeoutError) {
    log.warn("Gmail reader: no answer", { why: "timeout" });
    return { outcome: "unread" };
  }
  const status = error instanceof Anthropic.APIError ? error.status : undefined;
  const connection = error instanceof Anthropic.APIConnectionError;
  const reason: LaterReason =
    status !== undefined ? `${status}` : connection ? "CONNECTION" : "ERROR";
  log.warn("Gmail reader: can't be asked", { reason });
  return { outcome: "later", reason };
}

export async function readMoneyMail(
  mail: MoneyMail,
  { claude = anthropic }: { claude?: typeof anthropic } = {},
): Promise<MailReading> {
  if (!llmEnabled()) return { outcome: "later", reason: "OFF" };
  // Only these four go, whatever else the object handed in carries.
  const { received, from, subject, body } = mail;
  let text: string | null;
  try {
    const response = await claude().messages.create(
      {
        model: readerModel(),
        max_tokens: GMAIL_LIMITS.readerMaxTokens,
        system: SYSTEM,
        messages: [{ role: "user", content: JSON.stringify({ received, from, subject, body }) }],
        output_config: { effort: "low", format: { type: "json_schema", schema: SCHEMA } },
      },
      // One try: a busy API is Claude being unavailable, and the email is read when the read is
      // tried again (readerRetryMinutes), never after a wait the API asks for. The timeout is for
      // the answer to begin; the signal ends the request whatever it is still waiting on, the rest
      // of the answer included, so one email can't hold a read past its time.
      {
        timeout: GMAIL_LIMITS.readerTimeoutMs,
        maxRetries: 0,
        signal: AbortSignal.timeout(GMAIL_LIMITS.readerMostMs),
      },
    );
    text = finishedText(response);
    // Claude declined this email, or its answer was cut short.
    if (text === null) log.warn("Gmail reader: no answer", { why: response.stop_reason });
  } catch (error) {
    return notAnswered(error);
  }
  if (text === null) return { outcome: "unread" };
  let answer: unknown;
  try {
    answer = JSON.parse(text);
  } catch {
    answer = null;
  }
  if (typeof answer !== "object" || answer === null || Array.isArray(answer)) {
    log.warn("Gmail reader: no answer", { why: "not_json" });
    return { outcome: "unread" };
  }
  const given = answer as Record<string, unknown>;
  const kind = GMAIL_KINDS.find((known) => known === given.kind);
  if (!kind) return { outcome: "none" };
  const amountCents = amountOf(given.amount, mail);
  const occursOn = dateOf(given.date, received);
  if (amountCents === null && occursOn === null) return { outcome: "none" };
  return { outcome: "read", fact: { kind, amountCents, occursOn } };
}
