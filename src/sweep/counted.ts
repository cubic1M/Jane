import { isUpload, maybeSameAccounts, type CountAcct } from "@/planning/books";

// Class 12 (the founder, 11-24: "it should always match the data of Plaid and show no duplicate
// statements"): what net worth counts holds each account once. In what is counted, no account id and
// no (bank, type, last four) appears twice, and no upload sits beside a linked account it can't be
// told from (same bank and kind, no last four to tell them apart, or the same last four under
// another subtype), unless the person said an upload in the pair is an account of its own. Pure: a person's counted
// accounts in, the lines that break it out. `bankOf` is a link's bank, null for an upload.
export function countingProblems(
  counted: readonly CountAcct[],
  bankOf: (a: CountAcct) => string | null,
  separate: ReadonlySet<string> = new Set(),
): string[] {
  const lines: string[] = [];
  const ids = new Set<string>();
  const keys = new Set<string>();
  for (const a of counted) {
    if (ids.has(a.id)) lines.push(`${a.id} is counted twice`);
    ids.add(a.id);
    const bank = bankOf(a);
    if (a.mask && bank) {
      const key = `${bank}|${a.type}|${a.mask}`;
      if (keys.has(key)) lines.push(`${key} is counted twice`);
      keys.add(key);
    }
  }
  const uploads = counted.filter(isUpload);
  // Two uploads of one last four, type and subtype under related names: one account uploaded twice.
  const plain = (text: string) => text.toLowerCase().replace(/[^a-z0-9]/g, "");
  uploads.forEach((a, i) => {
    for (const b of uploads.slice(i + 1)) {
      const [m, n] = [plain(a.name), plain(b.name)];
      if (
        !separate.has(a.id) &&
        !separate.has(b.id) &&
        a.mask &&
        a.mask === b.mask &&
        a.type === b.type &&
        a.subtype === b.subtype &&
        m.length >= 4 &&
        n.length >= 4 &&
        (m.includes(n) || n.includes(m))
      )
        lines.push(`${a.name} and ${b.name} are one upload, counted twice`);
    }
  });
  for (const { a, b } of maybeSameAccounts(counted, bankOf)) {
    const bothLinked = !isUpload(a) && !isUpload(b);
    // Two links with no last four can't be told apart or merged: not asked of them.
    if (bothLinked && !(a.mask && b.mask)) continue;
    const mine = [a, b].filter((x) => uploads.includes(x));
    if (mine.some((x) => separate.has(x.id))) continue;
    lines.push(
      `${a.name} (${isUpload(a) ? "upload" : "link"}) and ${b.name} (${isUpload(b) ? "upload" : "link"}) may be one account, both counted`,
    );
  }
  return lines;
}
