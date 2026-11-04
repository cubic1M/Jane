// Invented statements, in layouts the app says it knows, as a person would download them from a
// bank's website. Every row is dated in the past relative to the run, inside the last six months.

export type Row = { daysAgo: number; description: string; cents: number };

function date(daysAgo: number): Date {
  return new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000);
}

function usDate(daysAgo: number): string {
  const d = date(daysAgo);
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${mm}/${dd}/${d.getUTCFullYear()}`;
}

function isoDate(daysAgo: number): string {
  return date(daysAgo).toISOString().slice(0, 10);
}

function quoted(text: string): string {
  return `"${text.replaceAll('"', '""')}"`;
}

function dollars(cents: number): string {
  return (cents / 100).toFixed(2);
}

/** Six charges about a month apart, the newest about ten days ago. */
export function monthly(description: string, cents: number): Row[] {
  return [12, 42, 73, 103, 134, 164].map((daysAgo) => ({ daysAgo, description, cents }));
}

/** What most people's account has around the thing being looked for. */
export function ordinaryLife(): Row[] {
  const rows: Row[] = [];
  for (const daysAgo of [5, 35, 66, 96, 127, 157]) {
    rows.push({ daysAgo, description: "NORTHWIND TOOLS PAYROLL PPD", cents: 310_000 });
    rows.push({
      daysAgo: daysAgo + 2,
      description: "MAPLE COURT APARTMENTS RENT",
      cents: -125_000,
    });
  }
  // Groceries: uneven days and uneven amounts, so nothing about them is a subscription.
  const shops: [number, number][] = [
    [3, 6412],
    [11, 2287],
    [26, 9105],
    [31, 4733],
    [47, 1859],
    [60, 7740],
    [72, 3361],
    [88, 5522],
    [101, 2946],
    [119, 8018],
    [140, 4177],
    [158, 6690],
  ];
  for (const [daysAgo, cents] of shops) {
    rows.push({ daysAgo, description: "CORNER GROCERY STORE", cents: -cents });
  }
  return rows;
}

function newestFirst(rows: Row[]): Row[] {
  return [...rows].sort((a, b) => a.daysAgo - b.daysAgo);
}

export type StatementFile = { name: string; mimeType: string; buffer: Buffer };

function csvFile(name: string, text: string): StatementFile {
  return { name, mimeType: "text/csv", buffer: Buffer.from(text) };
}

/** A Chase checking download: money in is positive, money out negative, with a running balance. */
export function chaseChecking(rows: Row[], name = "Chase_Activity.csv"): StatementFile {
  const lines = ["Details,Posting Date,Description,Amount,Type,Balance,Check or Slip #,"];
  let balance = 200_000 + rows.reduce((sum, r) => sum + r.cents, 0);
  for (const row of newestFirst(rows)) {
    const details = row.cents > 0 ? "CREDIT" : "DEBIT";
    const type = row.cents > 0 ? "ACH_CREDIT" : "DEBIT_CARD";
    lines.push(
      `${details},${usDate(row.daysAgo)},${quoted(row.description)},${dollars(row.cents)},${type},${dollars(balance)},,`,
    );
    balance -= row.cents;
  }
  return csvFile(name, `${lines.join("\n")}\n`);
}

/** A Bank of America checking download: a summary block, then rows, with commas in the figures. */
export function bankOfAmericaChecking(rows: Row[], name = "stmt.csv"): StatementFile {
  const oldestFirst = newestFirst(rows).reverse();
  const beginning = 410_000;
  const credits = rows.filter((r) => r.cents > 0).reduce((sum, r) => sum + r.cents, 0);
  const debits = rows.filter((r) => r.cents < 0).reduce((sum, r) => sum + r.cents, 0);
  const money = (cents: number) =>
    quoted((cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2 }));
  const start = usDate(oldestFirst[0].daysAgo + 1);
  const end = usDate(0);
  const lines = [
    "Description,,Summary Amt.",
    `Beginning balance as of ${start},,${money(beginning)}`,
    `Total credits,,${money(credits)}`,
    `Total debits,,${money(debits)}`,
    `Ending balance as of ${end},,${money(beginning + credits + debits)}`,
    "",
    "Date,Description,Amount,Running Bal.",
    `${start},Beginning balance as of ${start},,${money(beginning)}`,
  ];
  let balance = beginning;
  for (const row of oldestFirst) {
    balance += row.cents;
    lines.push(
      `${usDate(row.daysAgo)},${quoted(row.description)},${money(row.cents)},${money(balance)}`,
    );
  }
  return csvFile(name, `${lines.join("\n")}\n`);
}

/** A Capital One card download: charges and payments in separate Debit and Credit columns. */
export function capitalOneCard(rows: Row[], name = "transaction_download.csv"): StatementFile {
  const lines = ["Transaction Date,Posted Date,Card No.,Description,Category,Debit,Credit"];
  for (const row of newestFirst(rows)) {
    const day = isoDate(row.daysAgo);
    const debit = row.cents < 0 ? dollars(-row.cents) : "";
    const credit = row.cents > 0 ? dollars(row.cents) : "";
    lines.push(`${day},${day},0000,${quoted(row.description)},Other,${debit},${credit}`);
  }
  return csvFile(name, `${lines.join("\n")}\n`);
}

const MINIMAL_PDF =
  "%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n" +
  "2 0 obj<</Type/Pages/Kids[]/Count 0>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n";

/** Not statements at all, each given a .csv name. */
export const NOT_STATEMENTS: Record<string, StatementFile> = {
  "a photo": {
    name: "statement.csv",
    mimeType: "text/csv",
    buffer: Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      Buffer.alloc(400, 7),
    ]),
  },
  "a PDF": { name: "statement.csv", mimeType: "text/csv", buffer: Buffer.from(MINIMAL_PDF) },
  "a zip": {
    name: "statement.csv",
    mimeType: "text/csv",
    buffer: Buffer.concat([Buffer.from("PK\x03\x04"), Buffer.alloc(300, 1)]),
  },
  "a letter": {
    name: "statement.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(
      "Dear neighbour, the garden party is on Saturday, at noon, in the courtyard.\n" +
        "Please bring a chair, a dish, and something to drink.\n" +
        "See you there, with thanks, from flat four.\n",
    ),
  },
};

export const SMALL_PDF: StatementFile = {
  name: "holdout-renters-policy.pdf",
  mimeType: "application/pdf",
  buffer: Buffer.from(MINIMAL_PDF),
};
