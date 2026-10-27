// Before importing, /import says when files plainly don't fit where they're going: another bank's
// file into an existing account (a Wells Fargo file into "Chase card"; the page opens on the first
// account), two accounts' files in one upload (they'd land in one account), or a new account for a
// card Jane already has (two "Citi card"s). From the new-user passes. Client-safe: no server
// imports.

// Short names people give accounts, beside the bank's own.
const SHORT_NAMES: Record<string, readonly string[]> = {
  "Bank of America": ["bofa", "boa"],
  "American Express": ["amex"],
  "Wells Fargo": ["wf", "wells"],
};

function namesBank(accountName: string, bank: string): boolean {
  const name = accountName.toLowerCase();
  if (name.includes(bank.toLowerCase())) return true;
  const words = name.split(/[^a-z0-9]+/);
  return (SHORT_NAMES[bank] ?? []).some((short) => words.includes(short));
}

const isCard = (kind: string) => kind === "credit_card";

// What a previewed file says about its account: its bank (a layout Jane knows) and its kind.
export type FileFacts = { file: string; bank?: string; kind?: string };

// Two files that can't be one account: different banks, or a card's and a bank account's.
function twoAccounts(a: FileFacts, b: FileFacts): boolean {
  if (a.bank && b.bank && a.bank !== b.bank) return true;
  return !!a.kind && !!b.kind && isCard(a.kind) !== isCard(b.kind);
}

// Files from plainly different accounts in one upload: all their rows would land in one account
// (round 2: a Capital One 360 checking file and an Amex card's became one checking account). The
// upload waits until they go one at a time.
export function mixedFilesNote(files: readonly FileFacts[]): string | null {
  for (const [i, a] of files.entries()) {
    const b = files.slice(i + 1).find((other) => twoAccounts(a, other));
    if (b)
      return `${a.file} and ${b.file} look like two different accounts. Upload them one at a time, so each gets its own.`;
  }
  return null;
}

// A new account for files from an account Jane already has, by its bank and kind (round 2: a
// second Citi export made a second "Citi card").
export function existingAccountNote(
  accounts: readonly { name: string; kind?: string | null }[],
  files: readonly FileFacts[],
): string | null {
  for (const f of files) {
    if (!f.bank) continue;
    const same = accounts.find(
      (a) =>
        namesBank(a.name, f.bank!) && (!a.kind || !f.kind || isCard(a.kind) === isCard(f.kind)),
    );
    if (same)
      return `You already have ${same.name}. If ${f.file} is from it, pick it above, so its rows join the ones there.`;
  }
  return null;
}

// The line to show, or null when every file fits the account: its bank (when the layout says one)
// is in the account's name, and a card statement goes into a card, a bank account's into a bank
// account (when both kinds are known).
export function wrongAccountNote(
  account: { name: string; kind?: string | null },
  files: readonly FileFacts[],
): string | null {
  const bank = files.find((f) => f.bank && !namesBank(account.name, f.bank));
  if (bank?.bank)
    return `${bank.file} looks like a ${bank.bank} file, but it's going into ${account.name}. If that's wrong, pick its account above.`;
  const kind = account.kind;
  const other = kind ? files.find((f) => f.kind && isCard(f.kind) !== isCard(kind)) : undefined;
  if (other?.kind)
    return `${other.file} looks like a ${isCard(other.kind) ? "card" : "bank account"} statement, but it's going into ${account.name}. If that's wrong, pick its account above.`;
  return null;
}
