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
  /^(?:POS|DEBIT CARD|CHECKCARD|CHECK CARD|RECURRING)\s+(?:PURCHASE\s+)?/,
  /^PURCHASE AUTHORIZED ON \d{1,2}\/\d{1,2}\s+/,
  /^ORIG CO NAME:\s*/,
];

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

export function normalizeMerchant(description: string): Merchant | null {
  let text = normalizeDescription(description);
  for (const pattern of BOILERPLATE) text = text.replace(pattern, "");
  for (const pattern of PROCESSOR_PREFIXES) text = text.replace(pattern, "");

  // "AMZN MKTP US*2K4L91" -> "AMZN MKTP US": the part after * is an order or store code.
  const star = text.indexOf("*");
  if (star > 2) text = text.slice(0, star);

  text = text
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
  text = words.join(" ");

  if (!text) return null;
  return { name: titleCase(text), key: text.toLowerCase() };
}
