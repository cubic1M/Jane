import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";

// What Jane reads in a person's mail is shown to them on their mailboxes page and in their own
// Download my data, and used nowhere else ("Who sees it" in docs/setup/gmail.md). Every file that
// reads the mail tables is written down here, so a new reader fails this test until someone has
// decided it may read them. Download my data is the one reader that doesn't name the tables: it
// reads every table the person has, so the files that take it are written down instead.

// Every file that names the mail tables (gmailMailbox and gmailReading through a system client,
// gmailMailboxes and gmailReadings through scopedFor) or the page's views of them (mailboxesView,
// readingsView): the Gmail library, the mailboxes page, the settings page (it counts them), the
// scoped client, key rotation, and the two that remove mailboxes with everything else (deleting an
// account, and the inactivity clean-up). The routes, Disconnect and the daily job reach the tables
// only through the library, so they aren't here. Before a file is added, decide:
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
  /\b(?:gmailMailboxes|gmailMailbox|gmailReadings|gmailReading|mailboxesView|readingsView)\b/;
const GMAIL = "src/lib/gmail";

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

  it("is the files written down above, and no other", () => {
    const readers = files.filter((file) => NAMES_MAIL.test(text(file)));
    expect(readers.sort(), "decide the four things above first, then add the file").toEqual(
      [...READS_MAIL].sort(),
    );
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
