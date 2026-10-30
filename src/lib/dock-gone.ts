// Jane's cards the person has dealt with in this tab: answered, or followed to the page they
// point at (founder: "whenever I switch to a page based on the suggestion card's suggestion, the
// suggestion just reappears"). Every card stack leaves them out (the dock above the chat, the
// phone's sheet, Home), the dock's kept copy drops them, and its loads ask the server to skip
// them, so a load that started before the answer reached the server can't bring one back. For
// the tab's session: kept in sessionStorage, which the chat's frame shares with its page.

const KEY = "jane:dock-gone";
// The newest this many are kept, and the newest SKIP_SENT are sent with a load.
const MAX = 200;
export const SKIP_SENT = 50;
export const GONE_EVENT = "jane:card-gone";

let memory: string[] = [];

function stored(): string[] {
  try {
    const value = JSON.parse(window.sessionStorage.getItem(KEY) ?? "[]");
    return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
  } catch {
    return [];
  }
}

// Every id gone in this tab, oldest first: this page's, and any the frame or a reload added.
export function goneIds(): string[] {
  if (typeof window === "undefined") return [];
  return [...new Set([...stored(), ...memory])].slice(-MAX);
}

export function markGone(id: string): void {
  if (goneIds().includes(id)) return;
  memory = [...memory, id].slice(-MAX);
  try {
    window.sessionStorage.setItem(KEY, JSON.stringify(goneIds()));
  } catch {
    // Private window or storage blocked: this page still leaves it out.
  }
  window.dispatchEvent(new CustomEvent(GONE_EVENT, { detail: id }));
}

// For useSyncExternalStore: told when one goes here or in the frame (the storage event).
export function subscribeGone(onChange: () => void): () => void {
  window.addEventListener(GONE_EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(GONE_EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

// A stable snapshot (a string) of the gone ids, for useSyncExternalStore.
export const goneSnapshot = () => goneIds().join(",");
export const goneServerSnapshot = () => "";

// The cards still to show.
export function withoutGone<T extends { id: string }>(
  cards: readonly T[],
  gone: ReadonlySet<string> | readonly string[],
): T[] {
  const set = gone instanceof Set ? gone : new Set(gone);
  return cards.filter((c) => !set.has(c.id));
}

// What a dock load sends: the newest gone ids, for the server to leave out.
export const skipParam = (ids: readonly string[]): string => ids.slice(-SKIP_SENT).join(",");

// The server's side: the ids a load asked it to skip, at most SKIP_SENT, each a plausible id.
export function parseSkip(value: string | null): Set<string> {
  if (!value) return new Set();
  return new Set(
    value
      .split(",")
      .map((s) => s.trim())
      .filter((s) => /^[\w-]{1,64}$/.test(s))
      .slice(0, SKIP_SENT),
  );
}
