import { formatCents } from "@/lib/money";

// Answers a company's question from what Jane already knows (spec step 58), so the person
// is only asked what Jane can't know. Answers are built from the person's own data, never
// written freely, and some things Jane never gives out at all.

export type Fact =
  "card_last4" | "account_email" | "holder_name" | "charge_dates" | "charge_amounts";

// Never answered by Jane, whoever asks: the person is told instead, since a request for
// these by email is unusual.
const NEVER =
  /\b(password|passcode|pin\b|security (question|answer)|social security|ssn|date of birth|birth ?date|full (card|account) number|cvv|cvc|security code|one-time code|verification code)\b/i;

const ASKS: { fact: Fact; pattern: RegExp }[] = [
  { fact: "card_last4", pattern: /\b(last (4|four)( digits)?|card ending|ending in)\b/i },
  { fact: "account_email", pattern: /\be-?mail\b/i },
  {
    fact: "holder_name",
    pattern: /\b(full name|account holder'?s? name|name on the account|your name)\b/i,
  },
  { fact: "charge_dates", pattern: /\b(date|dates|when)\b/i },
  { fact: "charge_amounts", pattern: /\b(amount|amounts|how much)\b/i },
];

export type Asked = { kind: "facts"; facts: Fact[] } | { kind: "never" } | { kind: "unknown" };

export function whatIsAsked(question: string): Asked {
  if (NEVER.test(question)) return { kind: "never" };
  const facts = ASKS.filter((a) => a.pattern.test(question)).map((a) => a.fact);
  return facts.length > 0 ? { kind: "facts", facts } : { kind: "unknown" };
}

export type KnownFacts = {
  cardLast4: string | null;
  email: string | null;
  name: string | null;
  charges: { date: string; amountCents: number }[];
};

// The answer, or null if any fact asked for isn't known.
export function composeAnswer(facts: Fact[], known: KnownFacts): string | null {
  const parts: string[] = [];
  for (const fact of facts) {
    if (fact === "card_last4") {
      if (!known.cardLast4 || !/^\d{4}$/.test(known.cardLast4)) return null;
      parts.push(`The card ends in ${known.cardLast4}.`);
    } else if (fact === "account_email") {
      if (!known.email) return null;
      parts.push(`The account email is ${known.email}.`);
    } else if (fact === "holder_name") {
      if (!known.name?.trim()) return null;
      parts.push(`The account holder is ${known.name.trim()}.`);
    } else {
      if (known.charges.length === 0) return null;
      if (fact === "charge_dates" && !facts.includes("charge_amounts")) {
        parts.push(`The charges were on ${known.charges.map((c) => c.date).join(", ")}.`);
      } else if (fact === "charge_amounts" && !facts.includes("charge_dates")) {
        parts.push(
          `The charges were ${known.charges.map((c) => formatCents(c.amountCents)).join(", ")}.`,
        );
      } else if (fact === "charge_dates") {
        parts.push(
          `The charges were ${known.charges.map((c) => `${formatCents(c.amountCents)} on ${c.date}`).join(", ")}.`,
        );
      }
    }
  }
  return parts.length > 0 ? parts.join(" ") : null;
}
