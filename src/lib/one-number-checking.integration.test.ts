import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));

import { stubTestKeys } from "@/lib/__fixtures__/env";
import { FILE_SOURCE } from "@/lib/import/balances";
import { runChatTool } from "@/lib/jane-agent/claude-tools";

// Gate B, 11-18 (the chat tests' run of the desktop walk's S4 upload): "how much do I have
// invested?" gave checking as $3,022.33 and then "Your cash is $3,087.33" in one answer. The
// statement says $3,087.33; the safe-to-spend tool handed the chat its balance walked forward with a
// $65 Verizon bill due after the statement ends, as "checkingBalance". Home says that one is an
// estimate ("In checking, estimated"); now the chat's tool does too, and the balance it calls the
// balance is the statement's, the cash tool's own.

const url = process.env.TEST_DATABASE_URL;
// Wednesday Nov 18, 2026, 9am in Los Angeles; the statement ends Nov 13.
const NOW = new Date("2026-11-18T17:00:00Z");

describe.runIf(url)("checking, one figure in the chat", { timeout: 300_000 }, () => {
  let client: PrismaClient;
  let userId: string;

  beforeAll(async () => {
    stubTestKeys();
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url! }) });
    userId = (
      await client.user.create({
        data: { email: "one-number-checking@example.com", timezone: "America/Los_Angeles" },
      })
    ).id;
    const { id: accountId } = await client.account.create({
      data: {
        userId,
        source: "csv",
        name: "Chase checking",
        type: "depository",
        subtype: "checking",
        currentBalanceCents: 308_733,
      },
    });
    // The statement's balance, on the day it ends, as an upload keeps it.
    await client.balanceSnapshot.create({
      data: {
        userId,
        accountId,
        date: new Date("2026-11-13T00:00:00Z"),
        balanceCents: 308_733,
        source: FILE_SOURCE,
      },
    });
    // Aug 16 to Nov 13, uploaded Nov 13: Apple pay every two weeks, Verizon $65 on the 15th.
    const pay = ["08-21", "09-04", "09-18", "10-02", "10-16", "10-30", "11-13"];
    const rows = [
      ...pay.map((d) => ["2026-" + d, -121_500, "APPLE INC PAYROLL PPD", "INCOME_SALARY"] as const),
      ...["08-15", "09-15", "10-15"].map(
        (d) =>
          [
            "2026-" + d,
            6_500,
            "VERIZON WIRELESS PAYMENTS",
            "RENT_AND_UTILITIES_TELEPHONE",
          ] as const,
      ),
      ["2026-08-16", 4_210, "SAFEWAY STORE", "FOOD_AND_DRINK_GROCERIES"] as const,
    ].map(([date, amountCents, description, pfc], i) => ({
      userId,
      accountId,
      source: "csv" as const,
      dedupeKey: `checking-${i}`,
      date: new Date(`${date}T00:00:00Z`),
      amountCents,
      description,
      pfcPrimary: pfc.split("_")[0] === "RENT" ? "RENT_AND_UTILITIES" : pfc.split("_")[0]!,
      pfcDetailed: pfc,
      pending: false,
      categorySource: "rule" as const,
      createdAt: new Date("2026-11-13T20:00:00Z"),
    }));
    await client.transaction.createMany({
      data: rows.map((r) => ({
        ...r,
        pfcPrimary: r.pfcDetailed.startsWith("FOOD_AND_DRINK") ? "FOOD_AND_DRINK" : r.pfcPrimary,
      })),
    });
  });
  afterAll(async () => {
    await client.user.deleteMany({ where: { id: userId } });
    await client.$disconnect();
    vi.unstubAllEnvs();
  });

  it("calls the statement's balance the balance, and an estimate an estimate", async () => {
    const o = { client, now: NOW };
    const safe = JSON.parse((await runChatTool(userId, "safe_to_spend", {}, o)).content) as Record<
      string,
      string | undefined
    >;
    const cash = JSON.parse((await runChatTool(userId, "cash_plan", {}, o)).content) as {
      places: { kind: string; balance: string }[];
    };
    const checking = cash.places.find((p) => p.kind === "checking")!.balance;
    expect(checking).toBe("$3,087.33");
    // No figure called the checking balance that isn't the statement's.
    expect(safe.checkingBalance ?? safe.checkingBalanceOnTheStatement).toBe(checking);
    // The walked-forward one, the statement less Verizon's $65 due Nov 15, said as an estimate.
    expect(safe.checkingEstimatedToday).toBe("$3,022.33");
    expect(safe.estimate).toContain("expected since your");
  });
});
