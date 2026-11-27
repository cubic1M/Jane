// Before importing, /import says when files plainly don't fit where they're going: another bank's
// file into an existing account (a Wells Fargo file into "Chase card"; the page opens on the first
// account), two accounts' files in one upload (they'd land in one account), or a new account for a
// card Jane already has (two "Citi card"s). From the new-user passes. Client-safe: no server
// imports (types only).
import type { Verdict } from "@/planning/same-account";

// Short names people give accounts, beside the bank's own.
const SHORT_NAMES: Record<string, readonly string[]> = {
  "Bank of America": ["bofa", "boa"],
  "American Express": ["amex"],
  "Wells Fargo": ["wf", "wells"],
};

export function namesBank(accountName: string, bank: string): boolean {
  const name = accountName.toLowerCase();
  if (name.includes(bank.toLowerCase())) return true;
  const words = name.split(/[^a-z0-9]+/);
  return (SHORT_NAMES[bank] ?? []).some((short) => words.includes(short));
}

const isCard = (kind: string) => kind === "credit_card";

// What a previewed file says about its account: its bank (a layout Jane knows) and its kind.
export type FileFacts = { file: string; bank?: string; kind?: string; mask?: string | null };

// Two files that can't be one account: different banks, or a card's and a bank account's.
function twoAccounts(a: FileFacts, b: FileFacts): boolean {
  if (a.bank && b.bank && a.bank !== b.bank) return true;
  // The same bank's two accounts (ending 1234 and 5678): one account's last digits are never the
  // other's.
  if (a.mask && b.mask && !endsAlike(a.mask, b.mask, 2)) return true;
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
  if (bank?.bank) {
    // A card's file into a bank account (or the other way) says that too (QA round 10: "a Citi
    // file" into Wells Fargo checking, though the preview knew it was a card's).
    const other = !!account.kind && !!bank.kind && isCard(bank.kind) !== isCard(account.kind);
    const what = other ? `${bank.bank} ${isCard(bank.kind!) ? "card" : "bank account"}` : bank.bank;
    return `${bank.file} looks like a ${what} file, but it's going into ${account.name}. If that's wrong, pick its account above.`;
  }
  const kind = account.kind;
  const other = kind ? files.find((f) => f.kind && isCard(f.kind) !== isCard(kind)) : undefined;
  if (other?.kind)
    return `${other.file} looks like a ${isCard(other.kind) ? "card" : "bank account"} statement, but it's going into ${account.name}. If that's wrong, pick its account above.`;
  return null;
}

// A linked bank's account: its institution (the Plaid Item's institution name, from Link) and
// mask (Plaid: "the last 2-4 alphanumeric characters" of its number).
export type LinkedAccount = {
  id?: string;
  name: string;
  institution: string | null;
  mask: string | null;
  kind: string | null;
};

function endsAlike(a: string, b: string, min: number): boolean {
  const x = a.replace(/\W/g, "");
  const y = b.replace(/\W/g, "");
  return x.length >= min && y.length >= min && (x.endsWith(y) || y.endsWith(x));
}

// The last four agree: a shorter mask (Plaid allows two to four characters) proves nothing, since
// "12" ends many numbers.
const masksAgree = (a: string, b: string) => endsAlike(a, b, 4);

// A file from an account Jane already gets from a linked bank, whose transactions come in by
// themselves. Sure when the bank and the last four agree, and then the import waits. Otherwise the
// same bank and kind: what the note says follows what net worth does with the file
// (src/planning/same-account.ts, passed as `verdicts` by linked account id). "Different" says
// nothing (the file is counted), "same" says it is left out by itself, and when that can't be told
// it says the file is left out of net worth until it can, and how to count it. A savings file beside
// a linked checking account is another account, as is a different last four. The decision itself is
// made once the file is in (src/planning/books.ts accountsLeftOut).
export function linkedAccountNote(
  linked: readonly LinkedAccount[],
  files: readonly (FileFacts & { mask?: string | null; verdicts?: Record<string, Verdict> })[],
): { text: string; sure: boolean } | null {
  let maybe: { text: string; sure: boolean } | null = null;
  for (const f of files) {
    if (!f.bank) continue;
    const same = linked.filter(
      (l) =>
        l.institution &&
        namesBank(l.institution, f.bank!) &&
        (!l.kind || !f.kind || l.kind === f.kind),
    );
    const label = (l: LinkedAccount) => `${l.name}${l.mask ? ` ····${l.mask}` : ""}`;
    const sure = f.mask ? same.find((l) => l.mask && masksAgree(l.mask, f.mask!)) : undefined;
    if (sure) {
      return {
        sure: true,
        text: `You already link ${label(sure)} through ${sure.institution}, so its transactions come in by themselves. There's no need to import ${f.file}.`,
      };
    }
    const verdictOf = (l: LinkedAccount) => (l.id ? f.verdicts?.[l.id] : undefined) ?? "unknown";
    const open = same.filter((l) => (!f.mask || !l.mask) && verdictOf(l) !== "different");
    const [first, ...others] = open;
    if (!first || maybe) continue;
    const which =
      others.length === 0
        ? `your linked ${label(first)}`
        : `one of your linked ${first.institution} accounts`;
    maybe = open.some((l) => verdictOf(l) === "same")
      ? {
          sure: false,
          text: `${f.file} matches ${which}, whose transactions already come in from ${first.institution}, so Jane leaves it out of net worth by itself.`,
        }
      : {
          sure: false,
          text: `Jane can't yet tell whether ${f.file} is ${which}. Until it can, ${f.file} is left out of net worth; "This is a different account" on this page counts it.`,
        };
  }
  return maybe;
}
