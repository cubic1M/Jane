import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";

// What Jane reads in a person's mail is shown to them on their mailboxes page and in their own
// Download my data, and used nowhere else ("Who sees it" in docs/setup/gmail.md). Every file that
// reads the mail tables is written down here, so a new reader fails this test until someone has
// decided it may read them. Download my data is the one reader that doesn't name the tables: it
// reads every table the person has, so the files that take it are written down instead, and no
// other file may go through every table of a client.

// Every file whose code names the mail tables (gmailMailbox and gmailReading through a system
// client, gmailMailboxes and gmailReadings through scopedFor, gmail_mailboxes and gmail_readings in
// raw SQL) or the page's views of them (mailboxesView, readingsView): the Gmail library, the
// mailboxes page, the settings page (it counts them), the scoped client, key rotation, and the two
// that remove mailboxes with everything else (deleting an account, and the inactivity clean-up).
// The routes, Disconnect and the daily job reach the tables only through the library, so they
// aren't here. Before a file is added, decide:
// - Advice mode first: real mail must never get advice (REAL_ACCOUNT_ADVICE, src/config/advice.ts).
//   A chat answer, a card or a deadline made from a bill is advice as soon as it says what to do.
// - Never a partner or lending feature: Google's Limited Use allows no lending or credit use of
//   mail, and the privacy page promises that.
// - Never a team page: nobody at Jane reads a person's mail facts unless the person asks.
// - A calendar feed or an email would send mail facts outside Jane, where neither the page nor
//   Disconnect can take them back.
const READS_MAIL = [
  "src/app/settings/mailboxes/page.tsx",
  "src/app/settings/page.tsx",
  "src/lib/account-deletion.ts",
  "src/lib/db-scoped.ts",
  "src/lib/gmail/mailbox.ts",
  "src/lib/gmail/read-message.ts",
  "src/lib/gmail/sync.ts",
  "src/lib/key-rotation.ts",
  "src/lib/plaid/inactive.ts",
];

// The places those decisions are about, which take nothing from the Gmail library until they are
// made: the team's pages, the chat, offers, the cards (detection and its detectors), insights,
// plans, lending (the partner, its stand-in, loan applications and the loans pages), deadlines,
// alerts, the weekly email, the calendar feed, and the agent, whose emails go to companies.
const NEVER_READS_MAIL = [
  "src/app/admin",
  "src/lib/jane-agent",
  "src/lib/offers",
  "src/detection",
  "src/detectors",
  "src/insights",
  "src/planning",
  "src/lib/lender-partner.ts",
  "src/lib/lenders",
  "src/lib/loan-applications.ts",
  "src/app/loans",
  "src/lib/agent",
  "src/lib/deadlines.ts",
  "src/lib/alerts.ts",
  "src/lib/alert-email.ts",
  "src/lib/digest",
  "src/lib/calendar.ts",
  "src/app/api/calendar",
];

const NAMES_MAIL =
  /\b(?:gmailMailboxes|gmailMailbox|gmailReadings|gmailReading|mailboxesView|readingsView|gmail_mailboxes|gmail_readings)\b/;
const GMAIL = "src/lib/gmail";

// A database client, asked for: a person's (scopedFor, scopedDb) or one across people (systemDb).
const CLIENT = String.raw`(?:scopedFor|scopedDb|systemDb)\s*\(`;
// A call inside the client's argument, two deep: scopedFor(String(id)),
// scopedFor((await requireUser()).id).
const ARGS = String.raw`(?:[^()]|\((?:[^()]|\([^()]*\))*\))*`;
// The names a file holds such a client by: `const mine = scopedFor(id)`, `db: ScopedDb`, and the
// untyped one a transaction hands its callback, `personTransaction(id, async (tx) =>`. A name for
// what a query on one returned isn't one.
const HOLDS = new RegExp(
  String.raw`\b(\w+)\s*(?::\s*(?:ScopedDb|SystemDb|PersonTx|SystemTx|ReturnType<typeof\s+(?:scopedFor|systemDb)>)|=\s*(?:await\s+)?${CLIENT}${ARGS}\)(?!\s*[.?[]))` +
    String.raw`|\b(?:personTransaction|systemTransaction)\s*\([^()]*\(\s*(\w+)\s*\)\s*=>`,
  "g",
);

// A file's code: its lines that are only a comment left out, since a comment reads nothing
// (src/config/gmail-disclosure.ts names a mail table in one).
const code = (text: string): string =>
  text
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("//"))
    .join("\n");

// Whether code goes through every table of a client it holds, which reads the mail tables without
// naming them: Object.keys(db), Object.entries(scopedFor(id)), for (const name in mine).
function walksTables(text: string): boolean {
  const held = [...text.matchAll(HOLDS)].map((found) => `${found[1] ?? found[2]}\\b`);
  const client = String.raw`(?:await\s+)?(?:${[CLIENT, ...held].join("|")})`;
  return new RegExp(
    String.raw`(?:Object\.(?:keys|entries|values|getOwnPropertyNames)|Reflect\.ownKeys)\(\s*${client}|\bfor\s*\(\s*(?:const|let|var)\s+\w+\s+in\s+${client}`,
  ).test(text);
}

// The app's own source, as paths from the repository's root: tests, test fixtures and generated
// code left out.
function sources(dir = "src"): string[] {
  return readdirSync(join(process.cwd(), dir), { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      return /^(?:generated|test-setup|__fixtures__)$/.test(entry.name) ? [] : sources(path);
    }
    return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [path] : [];
  });
}

// Where a file's imports and exports point: `from "..."`, `import "..."` and `import("...")`.
function importsOf(text: string): string[] {
  return [...text.matchAll(/\bfrom\s*["']([^"']+)["']|\bimport\s*\(?\s*["']([^"']+)["']/g)].map(
    (found) => found[1] ?? found[2],
  );
}

// The file or folder an import in `file` points to, as a path from the repository's root, however
// the path is written. Null for a package.
function target(file: string, specifier: string): string | null {
  return specifier.startsWith("@/")
    ? join("src", specifier.slice(2))
    : specifier.startsWith(".")
      ? join(dirname(file), specifier)
      : null;
}

// Whether an import in `file` points into the Gmail library.
function intoGmail(file: string, specifier: string): boolean {
  const to = target(file, specifier);
  return to !== null && (to === GMAIL || to.startsWith(`${GMAIL}/`));
}

describe("who reads what Jane read in a mailbox", () => {
  const files = sources();
  const text = (file: string) => readFileSync(join(process.cwd(), file), "utf8");

  it("finds the source, and knows a reader and an import of the library when it sees one", () => {
    expect(files.length).toBeGreaterThan(100);
    expect(files).toContain("src/lib/gmail/sync.ts");
    expect(files.some((file) => /__fixtures__|generated|\.test\./.test(file))).toBe(false);
    expect(NAMES_MAIL.test("await scopedFor(userId).gmailReadings.findMany()")).toBe(true);
    expect(NAMES_MAIL.test("await systemDb(WHY).gmailMailbox.count()")).toBe(true);
    // A type names no rows.
    expect(NAMES_MAIL.test("import type { ReadingView } from '@/lib/gmail/mailbox';")).toBe(false);
    const sample =
      'import {\n  readingsView,\n} from "../gmail/mailbox";\nconst m = await import("@/lib/gmail/sync");';
    expect(importsOf(sample)).toEqual(["../gmail/mailbox", "@/lib/gmail/sync"]);
    expect(intoGmail("src/lib/jane-agent/tools.ts", "../gmail/mailbox")).toBe(true);
    expect(intoGmail("src/lib/jane-agent/tools.ts", "@/lib/gmail")).toBe(true);
    expect(intoGmail("src/lib/jane-agent/tools.ts", "@/lib/gmailish")).toBe(false);
    expect(intoGmail("src/lib/jane-agent/tools.ts", "@/config/gmail")).toBe(false);
    expect(target("src/lib/insurance/export.ts", "../data-export")).toBe("src/lib/data-export");
    // A file known to take something from the library is found taking it.
    const deletion = "src/lib/account-deletion.ts";
    expect(importsOf(text(deletion)).some((s) => intoGmail(deletion, s))).toBe(true);
  });

  it("knows raw SQL on the mail tables and a walk through every table of a client, and that a comment reads nothing", () => {
    const raw = 'await systemDb(WHY).$queryRaw`SELECT amount_cents FROM "gmail_readings"`;';
    expect(NAMES_MAIL.test(code(raw))).toBe(true);
    expect(NAMES_MAIL.test(code("await tx.$executeRaw`DELETE FROM gmail_mailboxes`;"))).toBe(true);
    expect(
      NAMES_MAIL.test(code("  // (gmail_mailboxes.disclosure_version), so a changed word")),
    ).toBe(false);
    expect(walksTables("export const all = (db: ScopedDb) => Object.keys(db);")).toBe(true);
    expect(walksTables("const tables = Object.entries(scopedFor(userId));")).toBe(true);
    expect(
      walksTables("const mine = await scopedDb();\nfor (const name in mine) seen.add(name);"),
    ).toBe(true);
    expect(walksTables('const all = systemDb("why");\nconst names = Reflect.ownKeys(all);')).toBe(
      true,
    );
    // A client asked for with a call in its argument, and the one a transaction hands its callback.
    expect(walksTables("const db = scopedFor(String(userId));\nObject.keys(db);")).toBe(true);
    expect(walksTables("const db = scopedFor((await requireUser()).id);\nObject.keys(db);")).toBe(
      true,
    );
    expect(walksTables("await personTransaction(userId, async (tx) => Object.keys(tx));")).toBe(
      true,
    );
    expect(
      walksTables("await systemTransaction(WHY, (tx) => {\n  for (const t in tx) seen(t);\n});"),
    ).toBe(true);
    // A row, or a name given what a query returned, is no client.
    const rows = "const db = scopedFor(userId);\nconst [row] = await db.accounts.findMany();";
    expect(walksTables(`${rows}\nObject.entries(row);`)).toBe(false);
    const found = "const session = await systemDb(WHY).session.findUnique(args);";
    expect(walksTables(`${found}\nconst signed = "mfa" in session;`)).toBe(false);
    const chained = "const mine = await scopedFor(String(userId)).accounts.findMany();";
    expect(walksTables(`${chained}\nObject.keys(mine);`)).toBe(false);
    // A file known to go through every table is found doing it.
    expect(walksTables(code(text("src/lib/data-export-rest.ts")))).toBe(true);
  });

  it("is the files written down above, and no other", () => {
    const readers = files.filter((file) => NAMES_MAIL.test(code(text(file))));
    expect(readers.sort(), "decide the four things above first, then add the file").toEqual(
      [...READS_MAIL].sort(),
    );
  });

  // A file that goes through every table of a client takes the mail tables with the rest. Download
  // my data is the one that does, for the person's own copy.
  it("goes through every table of a client only in Download my data", () => {
    const walkers = files.filter((file) => walksTables(code(text(file))));
    expect(walkers, "decide the four things above first").toEqual(["src/lib/data-export-rest.ts"]);
  });

  // Download my data writes out every table of the person's scoped client, the mail tables among
  // them (src/lib/data-export-rest.ts). It is the person's own copy: a team page or the chat that
  // took it would read their mail as well.
  it("is also Download my data, which only the person's own export takes", () => {
    const takers = (module: string) =>
      files.filter((file) => importsOf(text(file)).some((s) => target(file, s) === module)).sort();
    expect(takers("src/lib/data-export"), "decide the four things above first").toEqual([
      "src/app/api/export/route.ts",
    ]);
    expect(takers("src/lib/data-export-rest")).toEqual(["src/lib/data-export.ts"]);
  });

  it.each(NEVER_READS_MAIL)("is nothing in %s, which takes nothing from the library", (place) => {
    expect(existsSync(join(process.cwd(), place))).toBe(true);
    const there = files.filter((file) => file === place || file.startsWith(`${place}/`));
    expect(there.length).toBeGreaterThan(0);
    const takers = there.filter((file) => importsOf(text(file)).some((s) => intoGmail(file, s)));
    expect(takers).toEqual([]);
  });
});
