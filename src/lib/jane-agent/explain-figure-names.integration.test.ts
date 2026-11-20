import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));

import { runChatTool } from "./claude-tools";

// Walk batch 3's upload S5 (phone, 11-20): explain_figure handed Claude each income row as the bank
// wrote it, "UNIV OF CALIFORNIA PAYROLL PPD ID: 1234567890", ids and all. Its rows are now named
// as the other tools name them: the payer's cleaned name for pay, a cleaned merchant name for a
// purchase, and Transfer for a transfer, with no ids or card numbers.
const url = process.env.TEST_DATABASE_URL;
const NOW = new Date("2026-11-20T18:00:00Z");
const day = (date: string) => new Date(`${date}T00:00:00Z`);

describe.runIf(url)("explain_figure's transactions, as Claude reads them", () => {
  let client: PrismaClient;
  let id = "";

  beforeAll(async () => {
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
    const user = await client.user.create({
      data: { email: `explain-names-${crypto.randomUUID()}@example.com` },
    });
    id = user.id;
    const account = await client.account.create({
      data: {
        userId: id,
        source: "csv",
        name: "Chase checking",
        type: "depository",
        subtype: "checking",
        currentBalanceCents: 87_738,
      },
    });
    const tx = (date: string, amountCents: number, description: string, pfcPrimary: string) => ({
      userId: id,
      accountId: account.id,
      source: "csv" as const,
      dedupeKey: `${date}-${description}-${amountCents}`,
      date: day(date),
      amountCents,
      description,
      merchantName: null,
      pfcPrimary,
      pfcDetailed: null,
      categorySource: "rule" as const,
    });
    await client.transaction.createMany({
      data: [
        tx("2026-10-15", -62_000, "UNIV OF CALIFORNIA PAYROLL PPD ID: 1234567890", "INCOME"),
        tx("2026-10-29", -62_000, "UNIV OF CALIFORNIA PAYROLL PPD ID: 1234567890", "INCOME"),
        tx(
          "2026-10-11",
          4_312,
          "PURCHASE AUTHORIZED ON 10/11 SAFEWAY #1234 BERKELEY CA S586284123456789 CARD 5678",
          "FOOD_AND_DRINK",
        ),
        tx("2026-10-01", 90_000, "ZELLE TO SAM LEE ON 10/01 REF # PP0QWERTY12", "TRANSFER_OUT"),
      ],
    });
  });

  afterAll(async () => {
    await client.user.deleteMany({ where: { id } });
    await client.$disconnect();
  });

  const explain = async (figure: string) =>
    JSON.parse((await runChatTool(id, "explain_figure", { figure }, { client, now: NOW })).content)
      .transactions as { what: string; amount: string }[];

  it("names pay by its payer, without the bank's ids", async () => {
    const rows = await explain("monthly_income");
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) expect(r.what).toBe("Univ Of California Payroll");
    expect(JSON.stringify(rows)).not.toMatch(/PPD|\d{6,}/);
  });

  it("names a purchase by its merchant and a transfer as Transfer, with no card or ref numbers", async () => {
    const rows = await explain("monthly_spending");
    const text = JSON.stringify(rows);
    expect(text).not.toMatch(/\d{6,}|CARD 5678|REF #|SAM LEE/i);
    for (const r of rows) expect(r.what).not.toMatch(/PURCHASE AUTHORIZED/i);
  });
});
