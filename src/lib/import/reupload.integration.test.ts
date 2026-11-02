import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/categorize/llm", () => ({ classifyMerchants: vi.fn(async () => new Map()) }));

import type { ColumnMapping } from "@/data-sources/csv/column-mapping";
import { scopedFor } from "@/lib/db-scoped";
import { importCsvFiles } from "./import-csv";

// Raw files aren't kept, so uploading a file again is the only way rows read wrongly can be put
// right (debugger 11-02, founder's manager: #1159, #1161 and #1168 never reached anyone who had
// uploaded before them, because a re-upload skipped rows Jane already had). The file's rows correct
// the stored ones in place: no duplicates, the same row ids, and a person's own category stays.
const url = process.env.TEST_DATABASE_URL;

const USAA = `Date,Description,Original Description,Category,Amount,Status
2026-10-30,Lockheed Martin,LOCKHEED MARTIN DIRECT DEP,Paycheck,2950.00,Posted
2026-10-20,Commissary,DECA COMMISSARY NORFOLK VA,Groceries,-64.12,Posted
2026-10-15,Lockheed Martin,LOCKHEED MARTIN DIRECT DEP,Paycheck,2950.00,Posted
`;
const FIDELITY = `Run Date,Action,Symbol,Description,Type,Quantity,Price ($),Commission ($),Fees ($),Accrued Interest ($),Amount ($),Settlement Date
10/28/2026,DIVIDEND RECEIVED FIDELITY GOVERNMENT MONEY MARKET,SPAXX,No Description,Cash,0,,,,,28.40,
10/20/2026,DEBIT CARD PURCHASE COSTCO WHSE #0123 NORFOLK VA,,No Description,Cash,0,,,,,-212.55,
10/11/2026,ELECTRONIC FUNDS TRANSFER RECEIVED FID BKG SVC,,No Description,Cash,0,,,,,500,
09/11/2026,ELECTRONIC FUNDS TRANSFER RECEIVED FID BKG SVC,,No Description,Cash,0,,,,,500,
`;
// How the picker read it before #1161: "No Description" as the description, money out positive.
const fidelityBefore: ColumnMapping = {
  hasHeader: true,
  date: 0,
  description: 3,
  amount: { kind: "signed", column: 10, moneyOut: "positive" },
};
const fidelityNow: ColumnMapping = {
  hasHeader: true,
  date: 0,
  description: 1,
  amount: { kind: "signed", column: 10, moneyOut: "negative" },
};

const CHASE_HEADER = "Details,Posting Date,Description,Amount,Type,Balance,Check or Slip #";
const chase = (...rows: [string, string, number][]) =>
  [
    CHASE_HEADER,
    ...rows.map(
      ([date, description, amount]) =>
        `${amount < 0 ? "DEBIT" : "CREDIT"},${date},"${description}",${amount.toFixed(2)},ACH,1000.00,,`,
    ),
  ].join("\n");

describe.runIf(url)("uploading a file again", { timeout: 60_000 }, () => {
  let client: PrismaClient;
  const created: string[] = [];

  beforeAll(() => {
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  });
  afterAll(async () => {
    await client.user.deleteMany({ where: { id: { in: created } } });
    await client.$disconnect();
  });

  const account = async () => {
    const user = await client.user.create({
      data: { email: `reupload-${crypto.randomUUID()}@example.com` },
    });
    created.push(user.id);
    const { id } = await client.account.create({
      data: {
        userId: user.id,
        source: "csv",
        name: "Checking",
        type: "depository",
        subtype: "checking",
      },
    });
    return { db: scopedFor(user.id, client), userId: user.id, accountId: id };
  };
  const rowsOf = (userId: string) =>
    client.transaction.findMany({
      where: { userId },
      orderBy: [{ date: "desc" }, { id: "asc" }],
    });

  it("files a USAA paycheck as pay, on the same rows", async () => {
    const { db, userId, accountId } = await account();
    await importCsvFiles(db, accountId, [{ name: "usaa.csv", text: USAA }]);
    // As the column picker left them before USAA was a known layout: no category.
    await client.transaction.updateMany({
      where: { userId },
      data: { pfcPrimary: null, pfcDetailed: null, categorySource: null },
    });
    const before = await rowsOf(userId);

    const again = await importCsvFiles(db, accountId, [{ name: "usaa.csv", text: USAA }]);
    expect(again).toMatchObject({ inserted: 0, corrected: 3 });
    const after = await rowsOf(userId);
    expect(after.map((r) => r.id).sort()).toEqual(before.map((r) => r.id).sort());
    expect(after.map((r) => r.pfcDetailed)).toEqual([
      "INCOME_SALARY",
      "FOOD_AND_DRINK_GROCERIES",
      "INCOME_SALARY",
    ]);
  });

  it("puts right a Fidelity file read with the wrong sign and description: no duplicates", async () => {
    const { db, userId, accountId } = await account();
    await importCsvFiles(db, accountId, [
      { name: "f.csv", text: FIDELITY, mapping: fidelityBefore },
    ]);
    const before = await rowsOf(userId);
    expect(before).toHaveLength(4);
    expect(before.every((r) => r.description === "No Description")).toBe(true);
    // The person had filed the Costco row themselves.
    const costco = before.find((r) => r.date.toISOString().startsWith("2026-10-20"))!;
    await client.transaction.update({
      where: { id: costco.id },
      data: {
        pfcPrimary: "FOOD_AND_DRINK",
        pfcDetailed: "FOOD_AND_DRINK_GROCERIES",
        categorySource: "user",
      },
    });

    const again = await importCsvFiles(db, accountId, [
      { name: "f.csv", text: FIDELITY, mapping: fidelityNow },
    ]);
    expect(again).toMatchObject({ inserted: 0, corrected: 4 });
    const after = await rowsOf(userId);
    expect(after.map((r) => r.id).sort()).toEqual(before.map((r) => r.id).sort());
    expect(after.map((r) => r.amountCents)).toEqual([-2840, 21_255, -50_000, -50_000]);
    expect(after[0].description).toMatch(/^DIVIDEND RECEIVED/);
    const fixed = after.find((r) => r.id === costco.id)!;
    expect(fixed).toMatchObject({
      description: "DEBIT CARD PURCHASE COSTCO WHSE #0123 NORFOLK VA",
      amountCents: 21_255,
      // Their own category stays, on the right amount.
      pfcDetailed: "FOOD_AND_DRINK_GROCERIES",
      categorySource: "user",
    });
    // A third upload finds nothing to do.
    expect(
      await importCsvFiles(db, accountId, [
        { name: "f.csv", text: FIDELITY, mapping: fidelityNow },
      ]),
    ).toMatchObject({ inserted: 0, corrected: 0, duplicates: 4 });
  });

  it("keeps a person's own category when the rules would say otherwise", async () => {
    const { db, userId, accountId } = await account();
    const text = chase(
      ["10/05/2026", "NETFLIX.COM", -15.49],
      ["10/06/2026", "WHOLEFDS MKT 10234", -64.2],
    );
    await importCsvFiles(db, accountId, [{ name: "c.csv", text }]);
    const [whole] = await rowsOf(userId);
    await client.transaction.update({
      where: { id: whole.id },
      data: { pfcPrimary: "TRAVEL", pfcDetailed: "TRAVEL_OTHER_TRAVEL", categorySource: "user" },
    });
    expect(await importCsvFiles(db, accountId, [{ name: "c.csv", text }])).toMatchObject({
      corrected: 0,
    });
    expect((await rowsOf(userId))[0]).toMatchObject({
      pfcDetailed: "TRAVEL_OTHER_TRAVEL",
      categorySource: "user",
    });
  });

  it("corrects nothing and adds nothing when the same file comes again", async () => {
    const { db, userId, accountId } = await account();
    const text = chase(
      ["10/05/2026", "NETFLIX.COM", -15.49],
      ["10/05/2026", "NETFLIX.COM", -15.49],
    );
    await importCsvFiles(db, accountId, [{ name: "c.csv", text }]);
    const before = await rowsOf(userId);
    expect(await importCsvFiles(db, accountId, [{ name: "c.csv", text }])).toMatchObject({
      inserted: 0,
      corrected: 0,
      duplicates: 2,
    });
    expect(await rowsOf(userId)).toEqual(before);
  });

  it("doesn't take a new row for an old one of the same amount", async () => {
    const { db, userId, accountId } = await account();
    // $50 back from a shop, then a later file: that row, a new $50 purchase the same day, and others.
    await importCsvFiles(db, accountId, [
      {
        name: "a.csv",
        text: chase(
          ["10/05/2026", "CORNER SHOP REFUND", 50],
          ["10/06/2026", "ACME CORP PAYROLL PPD", 2000],
        ),
      },
    ]);
    const later = chase(
      ["10/05/2026", "CORNER SHOP REFUND", 50],
      ["10/05/2026", "HARDWARE STORE", -50],
      ["10/06/2026", "ACME CORP PAYROLL PPD", 2000],
    );
    expect(await importCsvFiles(db, accountId, [{ name: "b.csv", text: later }])).toMatchObject({
      inserted: 1,
      corrected: 0,
    });
    // And a lone new row beside an old one that isn't in the file stays apart too.
    const other = chase(["10/07/2026", "BOOK SHOP", 20]);
    await importCsvFiles(db, accountId, [{ name: "c.csv", text: other }]);
    const lone = chase(["10/07/2026", "TOY SHOP", -20]);
    expect(await importCsvFiles(db, accountId, [{ name: "d.csv", text: lone }])).toMatchObject({
      inserted: 1,
      corrected: 0,
    });
    expect((await rowsOf(userId)).map((r) => r.amountCents).sort((a, b) => a - b)).toEqual([
      -200_000, -5000, -2000, 2000, 5000,
    ]);
  });

  it("leaves a card payment found by its timing alone", async () => {
    const { db, userId, accountId } = await account();
    const text = chase(["10/05/2026", "SOME BILL PAY 8842", -300]);
    await importCsvFiles(db, accountId, [{ name: "c.csv", text }]);
    const [row] = await rowsOf(userId);
    await client.transaction.update({
      where: { id: row.id },
      data: {
        pfcPrimary: "LOAN_PAYMENTS",
        pfcDetailed: "LOAN_PAYMENTS_CREDIT_CARD_PAYMENT",
        categorySource: "rule",
      },
    });
    await importCsvFiles(db, accountId, [{ name: "c.csv", text }]);
    expect((await rowsOf(userId))[0].pfcDetailed).toBe("LOAN_PAYMENTS_CREDIT_CARD_PAYMENT");
  });
});
