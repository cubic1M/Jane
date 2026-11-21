import { normalizeAlias } from "@/data-sources/merchant-directory";

// What a card asks the person about a merchant, so the dock says one thing once (debug 3, 11-21:
// demo's "Drop an overlapping subscription" pick, which drops Spotify, beside "Review your Spotify
// subscription"). Whether to keep paying for a service is one matter, whichever card asks it: a
// subscription to review, the ones not used, the overlapping one, a cheaper plan of it (as #2153
// has it), a trial now billing. Any other topic is its own: Netflix's price rise and its cheaper
// plan are two.
const KEEP_PAYING: readonly string[] = [
  "subscription_review",
  "subscriptions",
  "duplicate_subscription",
  "cheaper_tier",
  "trial_conversion",
];
export const matterOf = (topic: string) => (KEEP_PAYING.includes(topic) ? "keep paying" : topic);

// A merchant as its key ("spotify"). A payee's own description reads longer ("SPOTIFY USA" is
// "spotify usa"), so a key that starts the other, word for word, is the same merchant.
const merchantKey = (name: unknown) => (typeof name === "string" ? normalizeAlias(name) : null);
export const sameMerchant = (a: string, b: string) =>
  a === b || a.startsWith(`${b} `) || b.startsWith(`${a} `);

// The merchants a suggestion asks about: the payees its watch names (src/detectors/contract.ts),
// not every name in its text ("You pay for Spotify, Audible, Peacock, Hulu and Netflix" drops two).
export function watchedMerchants(watch: unknown): string[] {
  const payees = (watch as { payees?: { description?: unknown }[] } | null)?.payees ?? [];
  return [...new Set(payees.flatMap((p) => merchantKey(p.description) ?? []))];
}

// The findings one of the day's picks already asks: the same matter about the same merchant.
export function saidByPicks(
  picks: readonly { topic: string; watch: unknown }[],
  findings: readonly { id: string; type: string; merchant: unknown }[],
): Set<string> {
  const asked = picks.flatMap((p) =>
    watchedMerchants(p.watch).map((merchant) => ({ matter: matterOf(p.topic), merchant })),
  );
  return new Set(
    findings.flatMap((f) => {
      const merchant = merchantKey(f.merchant);
      return merchant &&
        asked.some((a) => a.matter === matterOf(f.type) && sameMerchant(a.merchant, merchant))
        ? [f.id]
        : [];
    }),
  );
}
