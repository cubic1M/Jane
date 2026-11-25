import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));
vi.mock("@/lib/monthly-report", () => ({ monthlyReportFor: vi.fn(async () => null) }));

import { monthlyReportFor } from "@/lib/monthly-report";
import { loadClose, runMonthClose } from "./month-close";

// CodeRabbit sweep 1c (lib-02): a failed report doesn't freeze the close, a scheduled run doesn't
// reopen a month the person just confirmed, a tap that committed before its close failed still
// counts, and an account opened after the month ended isn't in that month's net worth.

const url = process.env.TEST_DATABASE_URL;
const NOW = new Date("2026-11-18T19:00:00Z");

describe.runIf(url)("the month close under failures and races", { timeout: 120_000 }, () => {
  let client: PrismaClient;
  const users: string[] = [];

  async function person(tag: string, newAccountAt?: string) {
    const email = `month-close-races-${tag}@example.com`;
    await client.user.deleteMany({ where: { email } });
    const userId = (await client.user.create({ data: { email } })).id;
    users.push(userId);
    const old = await client.account.create({
      data: {
        userId,
        source: "csv",
        name: "Checking",
        type: "depository",
        currentBalanceCents: 100_000,
        createdAt: new Date("2026-09-01T00:00:00Z"),
      },
    });
    if (newAccountAt) {
      const fresh = await client.account.create({
        data: {
          userId,
          source: "csv",
          name: "New savings",
          type: "depository",
          currentBalanceCents: 900_000,
          createdAt: new Date(`${newAccountAt}T00:00:00Z`),
        },
      });
      await client.balanceSnapshot.create({
        data: {
          userId,
          accountId: fresh.id,
          date: new Date(`${newAccountAt}T00:00:00Z`),
          balanceCents: 900_000,
        },
      });
      await client.transaction.create({
        data: {
          userId,
          accountId: fresh.id,
          source: "csv",
          date: new Date(`${newAccountAt}T00:00:00Z`),
          description: "OPENING DEPOSIT",
          amountCents: -900_000,
          pfcPrimary: "TRANSFER_IN",
          pfcDetailed: "TRANSFER_IN_ACCOUNT_TRANSFER",
        },
      });
    }
    const row = (date: string, description: string, amountCents: number, pfc: string) => ({
      userId,
      accountId: old.id,
      source: "csv" as const,
      date: new Date(`${date}T00:00:00Z`),
      description,
      amountCents,
      pfcPrimary: pfc.split("_")[0],
      pfcDetailed: pfc,
    });
    await client.transaction.createMany({
      data: [
        row("2026-10-16", "CAMPUS DINING PAYROLL PPD", -71_250, "INCOME_SALARY"),
        row(
          "2026-10-25",
          "OPENAI *CHATGPT SUBSCR",
          2_000,
          "GENERAL_SERVICES_OTHER_GENERAL_SERVICES",
        ),
      ],
    });
    return { userId, accountId: old.id };
  }

  beforeAll(() => {
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  });
  afterAll(async () => {
    await client.user.deleteMany({ where: { id: { in: users } } });
    await client.$disconnect();
  });

  it("leaves the close for the next run when the report errors", async () => {
    const { userId } = await person("report-error");
    vi.mocked(monthlyReportFor).mockRejectedValueOnce(new Error("report store down"));
    expect(await runMonthClose(userId, { client, now: NOW })).toBe("none");
    expect(await client.monthClose.count({ where: { userId } })).toBe(0);
  });

  it("does not write waiting over a month the person just confirmed", async () => {
    const { userId } = await person("confirmed-race");
    expect(await runMonthClose(userId, { client, now: NOW })).toBe("waiting");
    const waiting = await client.monthClose.findFirstOrThrow({ where: { userId } });
    // The person's tap lands after the scheduled run read the row, before it writes.
    vi.mocked(monthlyReportFor).mockImplementationOnce(async () => {
      await client.monthClose.update({
        where: { id: waiting.id },
        data: { status: "closed", uncertain: [], closedAt: NOW },
      });
      return null;
    });
    expect(await runMonthClose(userId, { client, now: NOW })).toBe("none");
    const after = await client.monthClose.findFirstOrThrow({ where: { userId } });
    expect(after.status).toBe("closed");
    expect(after.uncertain).toEqual([]);
  });

  it("counts charges confirmed before a close that failed", async () => {
    const { userId } = await person("confirmed-count");
    expect(await runMonthClose(userId, { client, now: NOW })).toBe("waiting");
    const waiting = await client.monthClose.findFirstOrThrow({ where: { userId } });
    // The tap committed ("user" source) but its close didn't.
    await client.transaction.updateMany({
      where: { id: { in: waiting.uncertain } },
      data: { categorySource: "user" },
    });
    expect(await runMonthClose(userId, { client, now: NOW })).toBe("closed");
    expect((await loadClose(userId, { client, month: "2026-10" }))!.figures.confirmed).toBe(1);
  });

  it("leaves an account opened in November out of October's net worth", async () => {
    const { userId } = await person("opened-later", "2026-11-05");
    await client.transaction.updateMany({
      where: { userId, description: { contains: "OPENAI" } },
      data: { categorySource: "user" },
    });
    expect(await runMonthClose(userId, { client, now: NOW })).toBe("closed");
    expect((await loadClose(userId, { client, month: "2026-10" }))!.figures.netWorthCents).toBe(
      100_000,
    );
  });
});
