import { CHAT_PRIMER_CACHE_SECONDS } from "@/config/agent-chat";

// Spec step 93: the person's main numbers for Claude (./claude-tools.ts chatPrimer), kept
// for CHAT_PRIMER_CACHE_SECONDS so a run of questions doesn't look them all up each time.
// In memory, per server instance; a tap in the chat clears the person's entry, since it can
// change what's open.

type Primer = { text: string; cents: number[] };

const MAX_PEOPLE = 500;
const cache = new Map<string, { at: number; primer: Primer }>();

export function cachedPrimer(userId: string, now: Date): Primer | null {
  const hit = cache.get(userId);
  if (!hit) return null;
  if (now.getTime() - hit.at >= CHAT_PRIMER_CACHE_SECONDS * 1000 || now.getTime() < hit.at) {
    cache.delete(userId);
    return null;
  }
  return hit.primer;
}

export function keepPrimer(userId: string, now: Date, primer: Primer): void {
  cache.delete(userId);
  cache.set(userId, { at: now.getTime(), primer });
  // The oldest out first.
  while (cache.size > MAX_PEOPLE) cache.delete(cache.keys().next().value!);
}

export function forgetPrimer(userId?: string): void {
  if (userId) cache.delete(userId);
  else cache.clear();
}
