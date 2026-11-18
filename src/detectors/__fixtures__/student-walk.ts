import { categorizeTransactions } from "@/categorize/categorize";
import { readCsvFile } from "@/data-sources/csv/csv-source";
import type { ScopedDb } from "@/lib/db-scoped";
import { buildProfile, type ProfileInput, type Told } from "@/profile/build";
import { runDetectors, type Suggestion } from "../index";

// Students as the beta sees them (suggest-taxes, 11-18): one bank account uploaded as a statement,
// a month or two of it, nothing told yet. The walk's shapes (e2e/dead-ends.spec.ts: one month, an
// old statement, checking only) and Stanford students' own (a fellowship, an RA job, a campus job,
// gig pay), read through the upload's own parser and rules (no Claude), so the tax detectors are
// measured on what a real upload gives them. Nothing here is a real person or account.

// The rules alone, as an upload with no merchant memory and no Claude categorizes.
const noMemory = {
  userId: "student-walk",
  merchantCategories: { findMany: async () => [], createMany: async () => ({ count: 0 }) },
} as unknown as Pick<ScopedDb, "userId" | "merchantCategories">;

export type StatementFile = { name: string; text: string };

// One checking account from its statement files, as /import reads them.
export async function inputFromStatements(
  files: readonly StatementFile[],
  today: string,
  told: Told = {},
): Promise<ProfileInput> {
  const rows = files.flatMap((f) => {
    const read = readCsvFile({ name: f.name, text: f.text });
    if (!read.ok) throw new Error(`${f.name}: ${read.error}`);
    return read.transactions.map((t) => ({ ...t, accountRef: "checking" }));
  });
  const categorized = await categorizeTransactions(rows, noMemory, { askClaude: false });
  return {
    today,
    transactions: categorized
      .filter((t) => !t.pending && t.date <= today)
      .map((t) => ({
        date: t.date,
        amountCents: t.amountCents,
        description: t.description,
        pfc: t.category?.detailed ?? null,
        accountId: "checking",
        merchantName: t.merchantName,
        uploadedOn: today,
      })),
    accounts: [
      {
        id: "checking",
        type: "depository",
        subtype: "checking",
        balanceCents: 0,
        balanceKnown: false,
      },
    ],
    liabilities: [],
    told,
  };
}

export function suggestionsOf(data: ProfileInput): Suggestion[] {
  return runDetectors({ profile: buildProfile(data), data });
}

// A Chase checking export (the layout the walk's one-month file uses), newest first.
export function chaseChecking(
  rows: readonly { date: string; description: string; amount: number }[],
): string {
  const header = "Details,Posting Date,Description,Amount,Type,Balance,Check or Slip #";
  const sorted = [...rows].sort((a, b) => b.date.localeCompare(a.date));
  const lines = sorted.map((r) => {
    const [y, m, d] = r.date.split("-");
    const kind = r.amount >= 0 ? "CREDIT" : "DEBIT";
    const type = r.amount >= 0 ? "ACH_CREDIT" : "DEBIT_CARD";
    return `${kind},${m}/${d}/${y},"${r.description}",${r.amount.toFixed(2)},${type},,`;
  });
  return [header, ...lines].join("\n");
}

// Every day from `from` to `to` on which `day` of the month falls.
const monthly = (from: string, to: string, day: number) => {
  const out: string[] = [];
  let y = Number(from.slice(0, 4));
  let m = Number(from.slice(5, 7));
  for (;;) {
    const date = `${y}-${String(m).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    if (date > to) return out;
    if (date >= from) out.push(date);
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
};
const every = (from: string, to: string, days: number) => {
  const out: string[] = [];
  for (let t = Date.parse(from); t <= Date.parse(to); t += days * 86_400_000)
    out.push(new Date(t).toISOString().slice(0, 10));
  return out;
};

// Everyday spending any of them has: groceries, coffee, a phone, a streaming plan, transit.
const everyday = (from: string, to: string) => [
  ...every(from, to, 6).map((date) => ({
    date,
    description: "SAFEWAY #1234 MOUNTAIN VIEW CA",
    amount: -48.6,
  })),
  ...every(from, to, 4).map((date) => ({
    date,
    description: "SQ *COUPA CAFE PALO ALTO CA",
    amount: -6.25,
  })),
  ...monthly(from, to, 9).map((date) => ({
    date,
    description: "VERIZON WIRELESS PAYMENTS",
    amount: -55,
  })),
  ...monthly(from, to, 14).map((date) => ({ date, description: "SPOTIFY USA", amount: -5.99 })),
  ...every(from, to, 10).map((date) => ({
    date,
    description: "CALTRAIN CLIPPER PALO ALTO",
    amount: -20,
  })),
];

export const STUDENT_TODAY = "2026-11-17";

// The Stanford shapes, each one checking account, months as named.
export const STUDENT_SHAPES: Readonly<Record<string, () => StatementFile[]>> = {
  // A PhD student on a fellowship: the stipend paid from the student account, nothing withheld;
  // rent off campus. One month.
  "fellowship-one-month": () => {
    const from = "2026-10-18";
    return [
      {
        name: "chase-fellowship.csv",
        text: chaseChecking([
          {
            date: "2026-11-02",
            description: "STANFORD UNIV STUDENT ACCT REFUND PPD ID: 1946001",
            amount: 4750,
          },
          { date: "2026-11-01", description: "AVALON MOUNTAIN VIEW RENT", amount: -2150 },
          ...everyday(from, STUDENT_TODAY),
        ]),
      },
    ];
  },
  // The same student over two months: two stipends.
  "fellowship-two-months": () => {
    const from = "2026-09-18";
    return [
      {
        name: "chase-fellowship-2.csv",
        text: chaseChecking([
          {
            date: "2026-10-01",
            description: "STANFORD UNIV STUDENT ACCT REFUND PPD ID: 1946001",
            amount: 4750,
          },
          {
            date: "2026-11-02",
            description: "STANFORD UNIV STUDENT ACCT REFUND PPD ID: 1946001",
            amount: 4750,
          },
          { date: "2026-10-01", description: "AVALON MOUNTAIN VIEW RENT", amount: -2150 },
          { date: "2026-11-01", description: "AVALON MOUNTAIN VIEW RENT", amount: -2150 },
          ...everyday(from, STUDENT_TODAY),
        ]),
      },
    ];
  },
  // A PhD student paid as an RA from October (withheld through payroll), in campus housing.
  "ra-two-months": () => {
    const from = "2026-09-18";
    return [
      {
        name: "chase-ra.csv",
        text: chaseChecking([
          ...["2026-10-07", "2026-10-22", "2026-11-07"].map((date) => ({
            date,
            description: "STANFORD UNIVERSITY PAYROLL PPD ID: 9460015",
            amount: 1985.4,
          })),
          ...monthly(from, STUDENT_TODAY, 3).map((date) => ({
            date,
            description: "STANFORD R&DE HOUSING PAYMENT",
            amount: -1640,
          })),
          ...everyday(from, STUDENT_TODAY),
        ]),
      },
    ];
  },
  // An undergraduate with a campus job, paying part of tuition, money from home. One month.
  "undergrad-one-month": () => {
    const from = "2026-10-18";
    return [
      {
        name: "chase-undergrad.csv",
        text: chaseChecking([
          ...["2026-10-23", "2026-11-06"].map((date) => ({
            date,
            description: "STANFORD UNIVERSITY PAYROLL PPD ID: 9460015",
            amount: 412.8,
          })),
          { date: "2026-10-20", description: "STANFORD UNIVERSITY TUITION PAYMENT", amount: -3200 },
          { date: "2026-10-25", description: "Zelle payment from LI MOM", amount: 600 },
          { date: "2026-10-28", description: "STANFORD BOOKSTORE", amount: -86.4 },
          { date: "2026-11-09", description: "STANFORD BOOKSTORE", amount: -42.1 },
          ...everyday(from, STUDENT_TODAY),
        ]),
      },
    ];
  },
  // A master's student who drives for DoorDash and repays a student loan. Two months.
  "gig-two-months": () => {
    const from = "2026-09-18";
    return [
      {
        name: "chase-gig.csv",
        text: chaseChecking([
          ...every("2026-09-21", STUDENT_TODAY, 7).map((date, i) => ({
            date,
            description: "DOORDASH DASHER PAYMENT",
            amount: 310 + (i % 3) * 45,
          })),
          ...monthly(from, STUDENT_TODAY, 20).map((date) => ({
            date,
            description: "NELNET STUDENT LOAN PAYMENT",
            amount: -215,
          })),
          ...monthly(from, STUDENT_TODAY, 1).map((date) => ({
            date,
            description: "OAK CREEK APARTMENTS RENT",
            amount: -1450,
          })),
          ...every(from, STUDENT_TODAY, 9).map((date) => ({
            date,
            description: "CHEVRON 0091234 PALO ALTO CA",
            amount: -42,
          })),
          ...everyday(from, STUDENT_TODAY),
        ]),
      },
    ];
  },
};
