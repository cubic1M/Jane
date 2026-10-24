// "Ask Jane" from the giant tree (src/components/hub/giant-tree.tsx): each question goes to
// Claude once per browser session (the Anthropic budget); asked again, the chat shows the
// earlier answer. Browser storage can be missing or throw: then nothing is remembered, and a
// question may go twice, which costs a little but breaks nothing.

const KEY = "jane.askedFromTree";

function read(): string[] {
  try {
    const raw = window.sessionStorage.getItem(KEY);
    const list: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list.filter((q): q is string => typeof q === "string") : [];
  } catch {
    return [];
  }
}

export function askedBefore(question: string): boolean {
  if (typeof window === "undefined") return false;
  return read().includes(question);
}

export function rememberAsked(question: string): void {
  try {
    const list = read();
    if (!list.includes(question)) {
      window.sessionStorage.setItem(KEY, JSON.stringify([...list, question].slice(-100)));
    }
  } catch {
    // Remembering is a guard, not a requirement.
  }
}
