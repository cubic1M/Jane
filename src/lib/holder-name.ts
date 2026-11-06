// The name Jane gives a company for the account holder, or null: one line of a name's letters, at
// most five words. It comes from the person's Google profile, which they write, and goes out under
// Jane's name, so it can't carry a second paragraph, a number or an address.
export function holderName(name: string | null | undefined): string | null {
  const words = (name ?? "")
    .replace(/[^\p{L}\p{M}' .-]/gu, " ")
    .split(/\s+/)
    .filter(Boolean);
  const kept = words.slice(0, 5).join(" ").slice(0, 60).trim();
  return /\p{L}/u.test(kept) ? kept : null;
}
