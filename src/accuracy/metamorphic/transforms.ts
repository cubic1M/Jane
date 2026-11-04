import { addDays, type CsvAccount, type CsvPerson, type Layout, type TrueRow } from "../csv/people";
import { renderAccount, type BenchFile } from "../csv/layouts";

// The changes to a statement that must not change what Jane finds (./metamorphic.test.ts). Each
// takes a bench person (src/accuracy/csv/people.ts) and gives back the same money said another way.

export const CHECKING_LAYOUTS: readonly Layout[] = [
  "chase_checking",
  "bofa_checking",
  "wells_fargo",
  "capital_one_360",
];
export const CARD_LAYOUTS: readonly Layout[] = [
  "chase_credit_card",
  "bofa_credit_card",
  "capital_one_credit_card",
  "citi_credit_card",
  "amex",
  "discover_credit_card",
];

// Balances are typed, so a layout with no balance column doesn't change what Jane knows.
export const inLayouts = (
  person: CsvPerson,
  layoutFor: (account: CsvAccount) => Layout,
): CsvPerson => ({
  ...person,
  accounts: person.accounts.map((a) => ({ ...a, layout: layoutFor(a), typesBalance: true })),
});

export const withBalancesTyped = (person: CsvPerson) => inLayouts(person, (a) => a.layout);

const ENTITIES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;" };
const escaped = (text: string) => text.replace(/[&<>]/g, (ch) => ENTITIES[ch]!);
const ofxDay = (iso: string) => `${iso.replaceAll("-", "")}120000[-5:EST]`;

export type OfxStyle =
  "name cut at 32 with the line in MEMO" | "merchant in NAME, the line in MEMO";

// An OFX 1.x download of the same accounts: the bank's id on every row, money out negative, in one
// file per account whatever the CSVs' windows were. Banks fill NAME in one of two ways, and cut it
// at the format's 32 characters.
export function renderOfx(person: CsvPerson, style: OfxStyle): BenchFile[] {
  return person.accounts.map((account) => {
    const { descriptions } = renderAccount(person, account)[0]!;
    const rows = person.rows.filter((r) => r.account === account.id);
    const line = (r: TrueRow) => descriptions[r.id]!.replace(/\s+/g, " ").trim();
    const blocks = rows.map((r) => {
      const name = (style.startsWith("name cut") ? line(r) : r.descriptor).slice(0, 32).trimEnd();
      return [
        "<STMTTRN>",
        `<TRNTYPE>${r.amountCents > 0 ? "DEBIT" : "CREDIT"}`,
        `<DTPOSTED>${ofxDay(r.date)}`,
        `<TRNAMT>${(-r.amountCents / 100).toFixed(2)}`,
        `<FITID>${r.id}`,
        `<NAME>${escaped(name)}`,
        `<MEMO>${escaped(line(r))}`,
        "</STMTTRN>",
      ].join("\n");
    });
    const [open, close] =
      account.kind === "credit_card" ? ["<CCSTMTRS>", "</CCSTMTRS>"] : ["<STMTRS>", "</STMTRS>"];
    return {
      name: `${account.id}.ofx`,
      account: account.id,
      text: ["OFXHEADER:100", "", "<OFX>", open, ...blocks, close, "</OFX>", ""].join("\n"),
      descriptions: Object.fromEntries(rows.map((r) => [r.id, line(r)])),
      rows: rows.map((r) => r.id),
      pending: 0,
    };
  });
}

// Every date and the clock, moved together.
export function shifted(person: CsvPerson, days: number): CsvPerson {
  const move = (date: string) => addDays(date, days);
  return {
    ...person,
    asOf: move(person.asOf),
    start: move(person.start),
    rows: person.rows.map((r) => ({
      ...r,
      date: move(r.date),
      ...(r.pendingCopy
        ? { pendingCopy: { ...r.pendingCopy, date: move(r.pendingCopy.date) } }
        : {}),
    })),
    uploads: person.uploads?.map((u) => ({ ...u, from: move(u.from), to: move(u.to) })),
  };
}

// One merchant under a name no list has heard of, on every one of its rows.
export const renamed = (person: CsvPerson, descriptor: string, to: string): CsvPerson => ({
  ...person,
  rows: person.rows.map((r) => (r.descriptor === descriptor ? { ...r, descriptor: to } : r)),
});

// A charge and its full refund a few days later, at a shop the person never went to otherwise.
export function withRefundedCharge(
  person: CsvPerson,
  account: string,
  date: string,
  amountCents: number,
  descriptor: string,
): CsvPerson {
  const base = {
    account,
    descriptor,
    category: "GENERAL_MERCHANDISE_OTHER_GENERAL_MERCHANDISE",
    kind: "spending",
  } as const;
  const rows: TrueRow[] = [
    { ...base, id: `${person.id}-m1`, date, amountCents, flow: "purchase" },
    {
      ...base,
      id: `${person.id}-m2`,
      date: addDays(date, 3),
      amountCents: -amountCents,
      flow: "refund",
    },
  ];
  return {
    ...person,
    rows: [...person.rows, ...rows].sort((a, b) => a.date.localeCompare(b.date)),
  };
}
