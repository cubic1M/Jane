import { readFileSync } from "node:fs";
import { PERSON_IDS, type PersonId } from "@/config/people";
import type { PrismaClient } from "@/generated/prisma/client";
import { madeUpChaseCsv } from "@/lib/__fixtures__/made-up-statement";
import { NO_PLAID } from "@/lib/__fixtures__/plaid";
import { encrypt } from "@/lib/crypto";
import { scopedFor } from "@/lib/db-scoped";
import { finishImport } from "@/lib/import/background";
import { saveUpload } from "@/lib/import/upload";
import { DEMO_TOKEN_PREFIX, linkDemoBank } from "@/lib/plaid/demo";
import { syncItem } from "@/lib/plaid/sync";

// The people the sweeps read (the calendar sweep, gate C, and the invariants, debug 3): the demo
// person, each sample person, and people who uploaded statements, thin ones included.
// "upload": a made-up Chase statement (src/lib/__fixtures__/made-up-statement.ts), uploaded: one
// statement, one account, no debts.
// "two-uploads": a checking statement that ended 25 days before and a card's to the day, uploaded
// together (debug 3, 11-16: one account's old data beside another's recent).
// "mid-start": a statement that starts 50 days before, mid-month (debug 3, 11-16: a window that
// starts before the data does).
// "one-month": a statement of the last 30 days only (debug 3, 11-19: "nothing coming up" and "1
// months" from too little history).
// "old-statement": a statement that ended 60 days before (debug 3, 11-19: "you pay" and "you keep"
// said about now from statements long over).
// "messy": a real bank's exports as they come (e2e/fixtures/messy, the messy-bank test's files):
// processor prefixes, ACH codes, transfers between their own accounts, two card exports that
// overlap, under four months (debug 3, 11-19: names shown as the bank's raw line). Its dates are
// fixed (July to October 2026), so read it in November 2026.
// "biweekly-month": upload S5, one month of Chase checking with three $620 paychecks every two
// weeks, its days moved to end the day before (debug 3, 11-19: income read as three paychecks a
// month, $1,860, and "Income near $28,489.50" on the Saver's Credit).
export type Who =
  | PersonId
  | "demo"
  | "upload"
  | "two-uploads"
  | "mid-start"
  | "one-month"
  | "old-statement"
  | "messy"
  | "biweekly-month";

export const UPLOADS: ReadonlySet<Who> = new Set<Who>([
  "upload",
  "two-uploads",
  "mid-start",
  "one-month",
  "old-statement",
  "messy",
  "biweekly-month",
]);

export const EVERYONE: readonly Who[] = ["demo", ...PERSON_IDS, ...UPLOADS];

const DAY_MS = 86_400_000;

// The made-up statement's lines posted after `day` (its Posting Date, MM/DD/YYYY), header kept.
export function postedAfter(csv: string, day: Date): string {
  const [header, ...lines] = csv.split("\n");
  const after = day.toISOString().slice(0, 10);
  const kept = lines.filter((line) => {
    const [m, d, y] = (line.split(",")[1] ?? "").split("/");
    return Boolean(y) && `${y}-${m}-${d}` > after;
  });
  return [header, ...kept, ""].join("\n");
}

const messy = (name: string) => readFileSync(`e2e/fixtures/messy/${name}`, "utf8");

const S5 =
  "src/lib/jane-agent/checks/__fixtures__/cells/upload-s5-phone/Chase1234_Activity_20261115.CSV";

// A Chase export's lines moved by whole days so its newest one posted on `last` (MM/DD/YYYY).
export function endingOn(csv: string, last: Date): string {
  const [header, ...lines] = csv.trim().split("\n");
  const dayOf = (line: string) => {
    const [m, d, y] = line.split(",")[1]!.split("/");
    return Date.parse(`${y}-${m}-${d}T00:00:00Z`);
  };
  const shift =
    Date.parse(`${last.toISOString().slice(0, 10)}T00:00:00Z`) - Math.max(...lines.map(dayOf));
  const moved = lines.map((line) => {
    const [y, m, d] = new Date(dayOf(line) + shift).toISOString().slice(0, 10).split("-");
    const cells = line.split(",");
    cells[1] = `${m}/${d}/${y}`;
    return cells.join(",");
  });
  return [header, ...moved, ""].join("\n");
}

// The statements an upload person sends, as [account name, kind, CSV]. Two with one name go to the
// same account, as a second statement for it.
function statementsOf(
  who: Who,
  linked: Date,
): [string, "checking" | "savings" | "credit_card", string][] {
  const ago = (days: number) => new Date(linked.getTime() - days * DAY_MS);
  switch (who) {
    case "upload":
      return [["Made-up checking", "checking", madeUpChaseCsv("ZZCHECKING", linked)]];
    case "mid-start":
      return [
        [
          "Made-up checking",
          "checking",
          postedAfter(madeUpChaseCsv("ZZCHECKING", linked), ago(50)),
        ],
      ];
    case "one-month":
      return [
        [
          "Made-up checking",
          "checking",
          postedAfter(madeUpChaseCsv("ZZCHECKING", linked), ago(30)),
        ],
      ];
    case "old-statement":
      return [["Made-up checking", "checking", madeUpChaseCsv("ZZCHECKING", ago(60))]];
    case "biweekly-month":
      return [["Chase checking", "checking", endingOn(readFileSync(S5, "utf8"), ago(1))]];
    case "messy":
      return [
        ["Everyday checking", "checking", messy("checking.csv")],
        ["Savings", "savings", messy("savings.csv")],
        ["Visa card", "credit_card", messy("card-jul-sep.csv")],
        ["Visa card", "credit_card", messy("card-aug-oct.csv")],
      ];
    default: {
      // "two-uploads". The card's file holds only what came after the checking file ends: the
      // two made-up statements share their lines, which the import rightly takes for the same
      // account's.
      const checkingEnds = ago(25);
      return [
        ["Made-up checking", "checking", madeUpChaseCsv("ZZCHECKING", checkingEnds)],
        [
          "Made-up card",
          "credit_card",
          postedAfter(madeUpChaseCsv("ZZCARD", linked), checkingEnds),
        ],
      ];
    }
  }
}

// The rows a test makes itself, not through the app: the person, and the demo bank's token. They
// go through the database's owner only when the test file writes them (TEST_CODE in
// src/config/deny-by-default.ts goes by the file calling), so the test passes these in.
export type OwnRows = {
  person: (data: { email: string; timezone: string }) => Promise<{ id: string }>;
  token: (itemId: string, accessTokenEncrypted: string) => Promise<unknown>;
};

// A person with their bank linked at `linked` and its first sync done, or with their statements
// through that day uploaded then. The caller sets the clock to `linked` first (some loaders read
// it themselves) and deletes `userId` after.
export async function makePerson(
  client: PrismaClient,
  own: OwnRows,
  who: Who,
  {
    linked,
    seed,
    email,
    timezone,
  }: { linked: Date; seed: string; email: string; timezone: string },
): Promise<{ userId: string; itemId: string | null }> {
  const user = await own.person({ email, timezone });
  if (UPLOADS.has(who)) {
    const accounts = new Map<string, string>();
    for (const [name, kind, csv] of statementsOf(who, linked)) {
      const form = new FormData();
      const known = accounts.get(name);
      form.set("accountId", known ?? "new");
      if (!known) {
        form.set("new.name", name);
        form.set("new.kind", kind);
      }
      form.append("files", new File([csv], "statement.csv", { type: "text/csv" }));
      const saved = await saveUpload(scopedFor(user.id, client), form, { client });
      if (!saved.ok) throw new Error(saved.error);
      accounts.set(name, saved.accountId);
      await finishImport(user.id, saved.runId, { client, now: linked });
    }
    return { userId: user.id, itemId: null };
  }
  const sample = who === "demo" ? undefined : (who as PersonId);
  const { itemId } = await linkDemoBank(user.id, {
    client,
    now: linked,
    ...(sample ? { person: sample } : {}),
  });
  const anchor = linked.toISOString().slice(0, 10);
  await own.token(
    itemId,
    encrypt(`${DEMO_TOKEN_PREFIX}${seed}:${anchor}${sample ? `:${sample}` : ""}`),
  );
  await syncItem(itemId, { client, api: NO_PLAID, now: linked });
  return { userId: user.id, itemId };
}
