// Finding a merchant the way a person says it against the way a bank writes it: "california arts"
// against "CALIFORNIA ARTS", "CA ARTS SUPPLY #12", "CALARTS" or "California Institute of the Arts".
// Pure text, no data: the chat's search (./tools.ts) feeds it each row's names.

// Words a bank adds that say nothing about who was paid.
const FILLER = new Set([
  "the",
  "of",
  "and",
  "inc",
  "llc",
  "co",
  "corp",
  "ltd",
  "pos",
  "debit",
  "purchase",
]);

export type NameMatch = "exact" | "similar" | null;

const words = (text: string): string[] =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter(Boolean);

const plain = (text: string) => words(text).join(" ");

// Can `token` be written as one piece from each of the asked words, in order: "calarts" is "cal"
// from california and "arts"; a bank squeezes a name into one word.
function squeezes(token: string, asked: string[]): boolean {
  if (asked.length < 2) return false;
  const rest = (from: number, at: number): boolean => {
    if (at === asked.length) return from === token.length;
    const word = asked[at];
    for (let n = Math.min(word.length, token.length - from); n >= 2; n--) {
      if (token.startsWith(word.slice(0, n), from) && rest(from + n, at + 1)) return true;
    }
    return false;
  };
  return rest(0, 0);
}

// What was asked for, tested against the names one row goes by. "exact": the asked words appear
// as written. "similar": every asked word is there as the start of a word, or as the start of a
// longer one it shortens ("ca" for california), or the whole name is squeezed into one word. A
// single short word never matches by shortening, so "net" doesn't find "netflix" by accident.
export function nameMatcher(asked: string): (names: readonly string[]) => NameMatch {
  const wanted = words(asked).filter((w) => !FILLER.has(w));
  const phrase = wanted.join(" ");
  if (phrase === "") return () => null;
  return (names) => {
    let similar = false;
    for (const name of names) {
      if (plain(name).includes(phrase)) return "exact";
      if (similar) continue;
      const tokens = words(name).filter((t) => !FILLER.has(t));
      const found = (w: string) =>
        tokens.some(
          (t) =>
            t === w ||
            (w.length >= 3 && t.startsWith(w)) ||
            (wanted.length > 1 && t.length >= 2 && w.startsWith(t)),
        );
      if (wanted.every(found) || tokens.some((t) => squeezes(t, wanted))) similar = true;
    }
    return similar ? "similar" : null;
  };
}
