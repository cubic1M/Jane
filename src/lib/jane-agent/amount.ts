import { parseMoneyToCents } from "@/lib/money";

// An amount typed in the chat, in cents (the intent parsers share it).

// A day or a year, never an amount: "nov 1", "november 15th", "the 1st", "10/30", "by 2027"
// (night QA 10-30: "can I afford rent on Nov 1?" checked a $1.00 purchase).
const DATE_WORDS =
  /\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.? \d{1,2}(?:st|nd|rd|th)?\b|\b\d{1,2}(?:st|nd|rd|th)\b|\b\d{1,2}\/\d{1,2}(?:\/\d{2,4})?\b|\b(?:in|by|until|before|after|of|for) (?:19|20)\d{2}\b/gi;

// Numbers that aren't money (11-03: "can i buy a house in 5 years" checked a $5.00 purchase, "put
// money in a 401k" a $401,000.00 one, "should i put 10% in" a $10.00 one).
const NOT_MONEY =
  /(?<![$\d,.])(?:(?:401|403|457)\s?\(?[kb]\)?|(?:529|1099)\b(?! dollars)|\d+(?:\.\d+)?\s?(?:%|percent\b)|\d+[- ](?:y(?:ea|ae)rs?|months?|mnths?|weeks?|days?|yrs?)\b)/gi;

// "$900", "900", "$1,200.50", "1.2k", "2 grand", "900 dollars". The first amount wins.
export function parseAmount(typed: string): number | null {
  const text = typed.replace(NOT_MONEY, " ");
  const scaled = /(?:^|[^\w.,])\$?\s?(\d+(?:\.\d+)?)\s?(k|grand|thousand)\b/.exec(text);
  const money = /\$\s?((?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d{1,2})?)/.exec(text);
  const worded = /(?:^|[^\w.,$])((?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d{1,2})?)\s?(?:dollars?|bucks|usd)\b/i.exec(text);
  // The first amount typed wins, whichever way it is written.
  const first = [
    scaled && { at: scaled.index, cents: Math.round(Number(scaled[1]) * 100_000) },
    money && { at: money.index, cents: parseMoneyToCents(money[1]) },
    worded && { at: worded.index, cents: parseMoneyToCents(worded[1]) },
  ]
    .filter((c): c is { at: number; cents: number | null } => Boolean(c))
    .sort((a, b) => a.at - b.at)[0];
  if (first) return first.cents !== null && first.cents > 0 ? first.cents : null;
  const bare = /(?:^|[^\w.,$])((?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d{1,2})?)\b/.exec(
    text.replace(DATE_WORDS, " "),
  );
  const found = bare?.[1];
  if (!found) return null;
  const cents = parseMoneyToCents(found);
  return cents !== null && cents > 0 ? cents : null;
}
