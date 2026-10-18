// Removes personal data and secrets from text before it's logged or stored. Errors can
// carry emails, account or card numbers, tokens and keys from wherever they were thrown.

const RULES: [RegExp, string][] = [
  [/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[email]"],
  // Plaid tokens: access-sandbox-..., public-production-..., link-...
  [/\b(access|public|link)-(sandbox|development|production)-[A-Za-z0-9-]+/g, "[plaid-token]"],
  // Stripe, Resend, Anthropic and similar keys.
  [/\b(sk|pk|rk)_(live|test)_[A-Za-z0-9]+/g, "[key]"],
  [/\bwhsec_[A-Za-z0-9]+/g, "[key]"],
  [/\bre_[A-Za-z0-9_]{10,}/g, "[key]"],
  [/\bsk-ant-[A-Za-z0-9_-]+/g, "[key]"],
  [/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [token]"],
  // JWTs.
  [/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, "[jwt]"],
  // Connection strings with passwords.
  [/\b(postgres(?:ql)?|mysql|redis):\/\/[^\s"']+/gi, "[database-url]"],
  // Long digit runs: account, card and phone numbers.
  [/\b\d[\d -]{7,}\d\b/g, "[number]"],
];

export function scrub(text: string): string {
  return RULES.reduce((out, [pattern, replacement]) => out.replace(pattern, replacement), text);
}

// A request path without its query string, which can hold tokens or emails.
export function scrubPath(path: string | null | undefined): string | null {
  if (!path) return null;
  return scrub(path.split("?")[0]);
}
