import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));

import { confirmClose, runMonthClose } from "./month-close";

// Debug 2, fifth desktop sweep (11-18, upload S5): after "Looks right" closed October, Spending &
// bills still had "Last month's close · $20 · Openai $20.00: I'm not sure what it was · Confirm
// the charges" (the scan's suggestion, until the next scan). Closing the month ends it.

const url = process.env.TEST_DATABASE_URL;
const NOW = new Date("2026-11-18T19:00:00Z");

describe.runIf(url)(
  "the month's close suggestion once the month closes",
  { timeout: 120_000 },
  () => {
    let client: PrismaClient;
    let userId = "";

    beforeAll(async () => {
      client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
      const email = "month-close-suggestion-gone@example.com";
      await client.user.deleteMany({ where: { email } });
      userId = (await client.user.create({ data: { email } })).id;
      const account = await client.account.create({
        data: { userId, source: "csv", name: "Wells Fargo checking", type: "depository" },
      });
      const row = (date: string, description: string, amountCents: number, pfc: string) => ({
        userId,
        accountId: account.id,
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
      await client.suggestion.create({
        data: {
          userId,
          key: "close:month_close",
          capability: "close",
          topic: "month_close",
          title: "Confirm one charge so October 2026 can close",
          short: "Openai $20.00: I'm not sure what it was.",
          worthCents: 2_000,
          worthKind: "risk",
          confidencePercent: 50,
          confidenceReason: "1 unsure charge",
          urgency: "soon",
          why: "",
          actionLabel: "Confirm the charges",
          actionHref: "/transactions",
          status: "selected",
        },
      });
    });
    afterAll(async () => {
      if (userId) await client.user.deleteMany({ where: { id: userId } });
      await client.$disconnect();
    });

    it("is gone after Looks right closes it", async () => {
      expect(await runMonthClose(userId, { client, now: NOW })).toBe("waiting");
      await confirmClose(userId, "2026-10", { client, now: NOW });
      const left = await client.suggestion.findMany({
        where: { userId, topic: "month_close" },
        select: { status: true },
      });
      expect(left).toEqual([{ status: "gone" }]);
    });
  },
);
