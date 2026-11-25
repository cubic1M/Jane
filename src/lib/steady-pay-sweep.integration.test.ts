import { PrismaPg } from "@prisma/adapter-pg";
import type { PlaidApi } from "plaid";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));

import { setAutopilot } from "@/lib/autopilot";
import { linkDemoBank } from "@/lib/plaid/demo";
import { syncItem } from "@/lib/plaid/sync";
import { setSectorAutopilot } from "@/lib/sector-autopilot";
import { loadSteady, payNow, runSteadyPay, SteadyError } from "./steady-pay";
import { stubTestKeys } from "@/lib/__fixtures__/env";

// CodeRabbit sweep 1c (lib-03) on the steady paycheck, with the demo bank and a year of uneven
// freelance deposits (the same set-up as steady-pay.integration.test.ts).

const url = process.env.TEST_DATABASE_URL;
const NOW = new Date("2026-10-16T15:00:00Z");
const day = (d: string) => new Date(`${d}T00:00:00Z`);
const DEPOSITS = [
  ["2026-04-10", 520_000],
  ["2026-05-06", 90_000],
  ["2026-06-20", 780_000],
  ["2026-07-15", 0],
  ["2026-08-03", 610_000],
  ["2026-09-12", 340_000],
  ["2026-10-14", 450_000],
] as const;

describe.runIf(url)("the steady paycheck: sweep 1c fixes", { timeout: 120_000 }, () => {
  let client: PrismaClient;
  const created: string[] = [];
  const api = new Proxy(
    {},
    {
      get: () => () => {
        throw new Error("no Plaid");
      },
    },
  ) as PlaidApi;

  async function freelancer(prefix: string, goalsActionCapCents = 2_000_000) {
    const user = await client.user.create({
      data: { email: `${prefix}-${crypto.randomUUID()}@example.com` },
    });
    created.push(user.id);
    const { itemId } = await linkDemoBank(user.id, { client, now: NOW });
    await syncItem(itemId, { client, api, now: NOW });
    await setAutopilot(user.id, "safe", { client, now: NOW });
    await setSectorAutopilot(
      user.id,
      "goals",
      { level: "safe", actionCapCents: goalsActionCapCents, monthlyCapCents: 5_000_000 },
      { client, now: NOW },
    );
    await setSectorAutopilot(
      user.id,
      "taxes",
      { level: "safe", actionCapCents: 2_000_000, monthlyCapCents: 5_000_000 },
      { client, now: NOW },
    );
    const checking = await client.account.findFirstOrThrow({
      where: { userId: user.id, subtype: "checking" },
    });
    for (const [date, cents] of DEPOSITS) {
      if (cents === 0) continue;
      await client.transaction.create({
        data: {
          userId: user.id,
          accountId: checking.id,
          source: "plaid",
          date: day(date),
          amountCents: -cents,
          description: "ACME DESIGN INVOICE",
          pfcPrimary: "INCOME",
          pfcDetailed: "INCOME_CONTRACTOR",
        },
      });
    }
    return user.id;
  }

  beforeAll(() => {
    stubTestKeys();
    vi.stubEnv("AUTH_SECRET", "test-secret-for-unsubscribe-links");
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  });
  afterAll(async () => {
    await client.user.deleteMany({ where: { id: { in: created } } });
    await client.$disconnect();
    vi.unstubAllEnvs();
  });

  it("finishes a deposit's buffer part after the cap held it back (each part has its own key)", async () => {
    // A cap under the buffer part, over the tax part: only the tax part moves the first time.
    const userId = await freelancer("steady-parts", 100_000);
    const first = await runSteadyPay(userId, { client, now: NOW });
    const keys = async () =>
      (
        await client.moneyTransfer.findMany({
          where: { userId, planKey: { startsWith: "deposit:" } },
        })
      )
        .map((t) => t.planKey!.split(":")[2])
        .sort();
    expect(await keys()).toEqual(["tax"]);
    expect(first.deposits).toBe(1);
    await setSectorAutopilot(
      userId,
      "goals",
      { level: "safe", actionCapCents: 2_000_000, monthlyCapCents: 5_000_000 },
      { client, now: NOW },
    );
    await runSteadyPay(userId, { client, now: NOW });
    expect(await keys()).toEqual(["buffer", "tax"]);
    // And still once each.
    await runSteadyPay(userId, { client, now: NOW });
    expect(await keys()).toEqual(["buffer", "tax"]);
  });

  it("moves only what is left of the deposit when the estimate changed between the two parts (#2261)", async () => {
    const userId = await freelancer("steady-split", 100_000);
    await runSteadyPay(userId, { client, now: NOW });
    // The tax part went out under an earlier, smaller estimate.
    const tax = (
      await client.moneyTransfer.findMany({
        where: { userId, planKey: { startsWith: "deposit:" } },
      })
    )[0]!;
    await client.moneyTransfer.update({ where: { id: tax.id }, data: { amountCents: 60_000 } });
    await setSectorAutopilot(
      userId,
      "goals",
      { level: "safe", actionCapCents: 2_000_000, monthlyCapCents: 5_000_000 },
      { client, now: NOW },
    );
    await runSteadyPay(userId, { client, now: NOW });
    const parts = await client.moneyTransfer.findMany({
      where: { userId, planKey: { startsWith: "deposit:" } },
    });
    expect(parts.reduce((sum, t) => sum + t.amountCents, 0)).toBe(450_000);
  });

  it("counts a paycheck that still waits for the partner as this month's", async () => {
    const userId = await freelancer("steady-await");
    const view = (await loadSteady(userId, { client, now: NOW }))!;
    await client.moneyTransfer.create({
      data: {
        userId,
        fromAccountId: view.bufferAccountId!,
        toAccountId: view.checkingAccountId!,
        toName: "Checking (your steady paycheck)",
        amountCents: 120_000,
        purpose: "goal",
        sector: "goals",
        status: "awaiting_partner",
        runOn: day("2026-10-17"),
        partner: "stand-in",
        by: "person",
        planKey: `steady:${view.month}`,
      },
    });
    const after = (await loadSteady(userId, { client, now: NOW }))!;
    expect(after.sent).toMatchObject({ amountCents: 120_000, by: "person" });
    await expect(payNow(userId, "person", { client, now: NOW })).rejects.toBeInstanceOf(
      SteadyError,
    );
    expect(
      await client.moneyTransfer.count({ where: { userId, planKey: { startsWith: "steady:" } } }),
    ).toBe(1);
  });

  it("leaves the tax money set aside in the buffer account out of the paycheck's room", async () => {
    const userId = await freelancer("steady-reserve");
    const before = (await loadSteady(userId, { client, now: NOW }))!;
    expect(before.taxReserveCents).toBe(0);
    const reserve = before.bufferCents; // all of it earmarked for tax
    await client.moneyTransfer.create({
      data: {
        userId,
        fromAccountId: before.checkingAccountId!,
        toAccountId: before.bufferAccountId!,
        toName: "Taxes set aside",
        amountCents: reserve,
        purpose: "goal",
        sector: "taxes",
        status: "completed",
        runOn: day("2026-09-20"),
        partner: "stand-in",
        by: "autopilot",
        planKey: "deposit:earlier:tax",
      },
    });
    const after = (await loadSteady(userId, { client, now: NOW }))!;
    expect(after.taxReserveCents).toBe(reserve);
    expect(after.plan!.paycheckCents).toBe(0);
    expect(after.plan!.status).toBe("no_floor_room");
    // Without the reserve the same buffer did allow a paycheck.
    expect(before.plan!.paycheckCents).toBeGreaterThan(0);
  });

  it("sends only the amount the caps were checked against", async () => {
    const userId = await freelancer("steady-authorized");
    const view = (await loadSteady(userId, { client, now: NOW }))!;
    const amount = view.plan!.paycheckCents;
    await expect(
      payNow(userId, "autopilot", { client, now: NOW, authorizedCents: amount - 100 }),
    ).rejects.toBeInstanceOf(SteadyError);
    expect(
      await client.moneyTransfer.count({ where: { userId, planKey: { startsWith: "steady:" } } }),
    ).toBe(0);
    const sent = await payNow(userId, "autopilot", { client, now: NOW, authorizedCents: amount });
    expect(sent.amountCents).toBe(amount);
  });
});
