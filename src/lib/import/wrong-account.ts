// Before importing into an existing account: a file that's plainly another bank's export (a Wells
// Fargo file going into "Chase card") gets one line saying so, since its rows would join that
// account's. New-user pass: /import opens on the first account, so a second bank's file went
// there unless the person changed it. Client-safe: no server imports.

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

// The line to show, or null when every file fits the account: its bank (when the layout says one)
// is in the account's name, and a card statement goes into a card, a bank account's into a bank
// account (when both kinds are known).
export function wrongAccountNote(
  account: { name: string; kind?: string | null },
  files: readonly { file: string; bank?: string; kind?: string }[],
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
