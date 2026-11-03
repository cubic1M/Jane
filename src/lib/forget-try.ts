// What this tab keeps of a person who is trying Jane, in the browser: Jane's kept cards, the
// cards dealt with and the questions asked. A new temporary person must never see the last one's,
// so each start and each "Start over" clears them, then does a full page load, which also empties
// what's held in memory (the router's cache, the side chat's store). Pages themselves are never
// cached on the device (public/sw.js). src/lib/forget-try.test.ts checks these are still the keys.

export const TRY_SESSION_KEYS = [
  "jane:dock-cards",
  "jane:dock-gone",
  "jane.askedFromTree",
] as const;

// A key may end in the person's id (the dock's cards), so these are matched as far as the id.
const kept = (key: string) => TRY_SESSION_KEYS.some((k) => key === k || key.startsWith(`${k}:`));

export function forgetThisTry(storage?: Pick<Storage, "length" | "key" | "removeItem">): void {
  try {
    const target = storage ?? window.sessionStorage;
    const keys = Array.from({ length: target.length }, (_, i) => target.key(i));
    for (const key of keys) if (key && kept(key)) target.removeItem(key);
  } catch {
    // Private window or storage blocked: nothing was kept.
  }
}
