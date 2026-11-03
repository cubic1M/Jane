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

export function forgetThisTry(storage?: Pick<Storage, "removeItem">): void {
  try {
    const target = storage ?? window.sessionStorage;
    for (const key of TRY_SESSION_KEYS) target.removeItem(key);
  } catch {
    // Private window or storage blocked: nothing was kept.
  }
}
