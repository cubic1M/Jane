// Money is always integer cents. Parsing goes through strings, never floats, so
// "0.10" + "0.20" can't turn into 30.000000000000004 cents.

const MONEY_PATTERN = /^(-)?\$?(\d{1,3}(?:,\d{3})+|\d+)?(?:\.(\d{1,2}))?$/;

// Accepts "12.34", "-12.34", "1,234.56", "$12", "(12.34)" (accounting negative) and ".5".
// Returns null for anything else.
export function parseMoneyToCents(input: string): number | null {
  let text = input.trim().replace(/\s+/g, "");
  let negative = false;
  if (/^\(.*\)$/.test(text)) {
    negative = true;
    text = text.slice(1, -1);
  }
  if (text.startsWith("$-")) text = `-$${text.slice(2)}`;

  const match = MONEY_PATTERN.exec(text);
  if (!match || (!match[2] && !match[3])) return null;

  const dollars = Number((match[2] ?? "0").replaceAll(",", ""));
  const cents = Number((match[3] ?? "0").padEnd(2, "0"));
  const total = dollars * 100 + cents;
  if (!Number.isSafeInteger(total)) return null;
  return (negative || match[1] ? -total : total) || 0;
}

export function formatCents(cents: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);
}

// Whole dollars, rounded, with thousands separators: "$1,235" for 123,456 cents.
export const formatWholeDollars = (cents: number): string =>
  `$${Math.round(cents / 100).toLocaleString("en-US")}`;
