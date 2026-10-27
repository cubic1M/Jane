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

// The line to show, or null when every known file's bank is in the account's name (or no file
// says its bank: a layout the person mapped, an OFX file).
export function wrongAccountNote(
  accountName: string,
  files: readonly { file: string; bank?: string }[],
): string | null {
  const other = files.find((f) => f.bank && !namesBank(accountName, f.bank));
  if (!other?.bank) return null;
  return `${other.file} looks like a ${other.bank} file, but it's going into ${accountName}. If that's wrong, pick its account above.`;
}
