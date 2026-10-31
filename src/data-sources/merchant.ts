// Turns a raw bank description into a clean merchant name, so "SQ *BLUE BOTTLE #123
// 10/03" and "BLUE BOTTLE 456" both become "Blue Bottle".

// Payment processors and card networks that prefix the real merchant.
const PROCESSOR_PREFIXES = [
  /^SQ\s*\*\s*/,
  /^TST\s*\*\s*/,
  /^PAYPAL\s*\*\s*/,
  /^PP\s*\*\s*/,
  /^SP\s*\*\s*/,
  /^SP\s+/,
  /^GOOGLE\s*\*\s*/,
  /^CKE\s*\*\s*/,
  /^DD\s*\*\s*/,
  /^IC\s*\*\s*/,
  /^BT\s*\*\s*/,
];

// Bank boilerplate around the merchant.
const BOILERPLATE = [
  // Capital One 360 writes "Debit Card Purchase - PAYPAL *HULU": the dash goes too, or the
  // processor prefix after it isn't seen (CSV bench: Hulu read as "Paypal").
  // Bank of America's "CHECKCARD 0818 PAYPAL *HULU": the date goes too, for the same reason.
  /^(?:POS|DEBIT CARD|CHECKCARD|CHECK CARD|RECURRING)\s+(?:PURCHASE\s+)?(?:-\s+)?(?:\d{4}\s+)?/,
  /^PURCHASE AUTHORIZED ON \d{1,2}\/\d{1,2}\s+/,
  /^ORIG CO NAME:\s*/,
  // Navy Federal's "PAID TO - USAA P&C INS" and "DEPOSIT - DFAS-CLEVELAND MIL PAY" (debugger
  // 10-30: the insurance card read "You pay Paid To Usaa P&C Ins").
  /^(?:PAID TO|DEPOSIT)\s+-\s+/,
  // Capital One 360's "Withdrawal to ROCKET MORTGAGE PMT" and "Deposit from STARK INDUSTRIES
  // PAYROLL" (debugger 10-31: "Withdrawal To Rocket Mortgage Pmt $2,280.00 monthly").
  /^(?:WITHDRAWAL TO|DEPOSIT FROM)\s+/,
];

// A payment app in front of the person or company paid: "ZELLE TO OAK RIDGE APTS RENT" is Oak
// Ridge Apts (overnight beta list), and money in keeps its direction ("ZELLE FROM MOM" is From
// Mom), so a category set for one isn't used for the other. Run on the cleaned words, so the
// same patterns move saved keys in SQL (prisma/migrations/20270414000000_merchant_without_
// payment_app): keep them in step. No \b: Postgres reads it as a backspace.
const PAYMENT_APP =
  /^(?:ZELLE|VENMO|CASH ?APP|APPLE CASH)(?: (?:PAYMENT|MONEY|TRANSFER))?(?: (?:SENT|RECEIVED))? (TO|FROM) (.+)$/;
// After the payee: the bank's memo, date and reference ("FOR RENT", "ON 10/03 REF # WFCT0ABC").
const PAYMENT_APP_MEMO = / (?:FOR|ON|REF|CONF|MEMO)(?: .*)?$/;
// A last word that says what the money was for, not who got it.
const PAYMENT_APP_PURPOSE = / (?:RENT|PAYMENT|PMT)$/;

export function withoutPaymentApp(text: string): string {
  const match = PAYMENT_APP.exec(text);
  if (!match) return text;
  const payee = match[2].replace(PAYMENT_APP_MEMO, "").replace(PAYMENT_APP_PURPOSE, "");
  if (!payee) return text;
  return match[1] === "FROM" ? `FROM ${payee}` : payee;
}

const US_STATES = new Set(
  "AL AK AZ AR CA CO CT DE FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY DC".split(
    " ",
  ),
);

// Reference codes and long numbers ("2K4L91", "000123") rather than names like "7-Eleven"
// or "76": three or more digits, or a mix with at least two digits in five characters or more.
function isCode(word: string): boolean {
  const digits = word.replace(/\D/g, "").length;
  return /^\d{3,}$/.test(word) || (word.length >= 5 && digits >= 2);
}

function titleCase(text: string): string {
  return text.toLowerCase().replace(/(^|[\s&/-])([a-z])/g, (_, sep: string, ch: string) => {
    return sep + ch.toUpperCase();
  });
}

export function normalizeDescription(description: string): string {
  return description.toUpperCase().replace(/\s+/g, " ").trim();
}

export type Merchant = { name: string; key: string };

// Citi pads the merchant to a column before the city and state ("SPOTIFY USA        SAN
// FRANCISCO  CA"): the padding is where the merchant ends.
function beforePadding(description: string): string {
  const match = /^(.*?\S)\s{3,}[A-Za-z .'-]+?\s+([A-Za-z]{2})\s*$/.exec(description);
  return match && US_STATES.has(match[2].toUpperCase()) ? match[1] : description;
}

// The company on a Bank of America ACH line, which comes before " DES:"; the rest is the entry's
// description, ids and the account holder's name ("GLOBEX LLC DES:PAYROLL ID:… INDN:SAM …").
// Other lines are unchanged. For names shown as they are (night QA 10-30: "Your employer: GLOBEX
// LLC DES:PAYROLL ID:XXXXX9028 INDN:EXAMPLE,SAM CO ID:XXXXX PPD" in What Jane knows).
export function withoutAchDetails(description: string): string {
  const des = description.search(/\s+DES:/i);
  return des > 0 ? description.slice(0, des).trim() : description;
}

export function normalizeMerchant(description: string): Merchant | null {
  let text = normalizeDescription(beforePadding(description));
  for (const pattern of BOILERPLATE) text = text.replace(pattern, "");
  for (const pattern of PROCESSOR_PREFIXES) text = text.replace(pattern, "");

  // Bank of America's ACH lines: "NETFLIX.COM DES:NETFLIX.COM ID:… INDN:… CO ID:… WEB". The
  // company comes before DES:; the rest is the entry's description and ids.
  const des = text.indexOf(" DES:");
  if (des > 0) text = text.slice(0, des);

  // "AMZN MKTP US*2K4L91" -> "AMZN MKTP US": the part after * is an order or store code.
  const star = text.indexOf("*");
  if (star > 2) text = text.slice(0, star);

  text = text
    .replace(/\s+CARD\s+\d{4}$/, " ") // Wells Fargo's "… CARD 1234": the card's last digits
    .replace(/\b\d{1,2}\/\d{1,2}(?:\/\d{2,4})?\b/g, " ") // dates
    .replace(/#\s*\d+/g, " ") // store numbers like #1234
    .replace(/\b(?:STORE|STR|NO)\s*\d+\b/g, " ")
    .replace(/\b(?:PPD|WEB|CCD|TEL)\s+ID:?\s*\S*/g, " ") // ACH entry codes
    .replace(/\b(?:WWW\.)?([A-Z0-9-]+)\.(?:COM|NET|ORG|CO)\b(?:\/\S*)?/g, "$1") // netflix.com
    .replace(/[^A-Z0-9&' -]+/g, " ");

  let words = text.split(/\s+/).filter((word) => /[A-Z0-9]/.test(word) && !isCode(word));
  // A trailing state code is location, not merchant. City names stay: we can't tell
  // them apart from merchant words reliably.
  if (US_STATES.has(words[words.length - 1])) words.pop();
  // Chase often repeats the merchant: "NETFLIX.COM NETFLIX.COM" -> "NETFLIX".
  const half = words.length / 2;
  if (Number.isInteger(half) && words.slice(0, half).join(" ") === words.slice(half).join(" ")) {
    words = words.slice(0, half);
  }
  text = withoutPaymentApp(words.join(" "));

  if (!text) return null;
  return { name: titleCase(text), key: text.toLowerCase() };
}

// When a description ends in a US state, the city before it may still be in the merchant's key
// ("SPOTIFY P1A2B3C4D5 CHICAGO IL" is "spotify chicago"): the key with its last one or two words
// dropped, for matching a known company (src/detection/merchants.ts). Nothing when there's no
// state, so "apple store" is never "apple".
export function withoutCity(description: string): string[] {
  // The last word that isn't a reference number (Bank of America ends with one).
  const last = normalizeDescription(description)
    .split(" ")
    .filter((word) => !isCode(word))
    .at(-1);
  if (!last || !US_STATES.has(last)) return [];
  const words = normalizeMerchant(description)?.key.split(" ") ?? [];
  return [1, 2].filter((n) => words.length > n).map((n) => words.slice(0, -n).join(" "));
}
