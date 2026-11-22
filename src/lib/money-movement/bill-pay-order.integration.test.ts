import { PrismaPg } from "@prisma/adapter-pg";
import type { PlaidApi } from "plaid";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));

import { linkDemoBank } from "@/lib/plaid/demo";
import { syncItem } from "@/lib/plaid/sync";
import { stubTestKeys } from "@/lib/__fixtures__/env";
import { loadBillPay } from "./bill-pay";

// Main went red on c95a09d7 (debug 3, 11-22): src/sweep/same-twice.integration.test.ts made one
// person twice and the dock had "Your Demo Student Loan payment is due Nov 20" and "Your Demo
// Credit Card payment is due Nov 26" in one order, then the other. The bills came in the
// database's own order, the batch Jane posts keeps it, and each card's time follows its place in
// the batch (./messages.ts postMessages). Here the rows are stored in both orders.

const url = process.env.TEST_DATABASE_URL;
const LINKED = new Date("2026-10-16T15:00:00Z");

describe.runIf(url)("the bills due, in the order the data decides", { timeout: 120_000 }, () => {
  let client: PrismaClient;
  let userId: string;
  const api = new Proxy(
    {},
    {
      get: () => () => {
        throw new Error("no Plaid");
      },
    },
  ) as PlaidApi;

  beforeAll(async () => {
    stubTestKeys();
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
    userId = (
      await client.user.create({ data: { email: `bill-order-${crypto.randomUUID()}@example.com` } })
    ).id;
    const { itemId } = await linkDemoBank(userId, { client, now: LINKED });
    await syncItem(itemId, { client, api, now: LINKED });
    // Two bills due within the window, the later one stored first.
    const rows = await client.liability.findMany({ where: { userId } });
    expect(rows.length).toBeGreaterThanOrEqual(2);
    await client.liability.updateMany({
      where: { userId },
      data: { minimumPaymentCents: 5_000, nextPaymentDueDate: null },
    });
    await client.liability.update({
      where: { id: rows[0].id },
      data: { nextPaymentDueDate: new Date("2026-10-26T00:00:00Z") },
    });
    await client.liability.update({
      where: { id: rows[1].id },
      data: { nextPaymentDueDate: new Date("2026-10-20T00:00:00Z") },
    });
  });
  afterAll(async () => {
    await client.user.deleteMany({ where: { id: userId } });
    await client.$disconnect();
  });

  // The liabilities stored again, in the given order (the database returns rows with no ORDER BY
  // roughly as they were written).
  const storedInOrder = async (reverse: boolean) => {
    const rows = await client.liability.findMany({ where: { userId }, orderBy: { id: "asc" } });
    await client.liability.deleteMany({ where: { userId } });
    for (const row of reverse ? [...rows].reverse() : rows)
      await client.liability.create({ data: row as never });
  };
  const due = async () =>
    (await loadBillPay(userId, { client, now: LINKED })).items.map(
      (i) => `${i.bill.dueOn} ${i.bill.name}`,
    );

  it("is soonest first, however the rows were stored", async () => {
    await storedInOrder(false);
    const one = await due();
    await storedInOrder(true);
    const other = await due();
    expect(one).toHaveLength(2);
    expect(other).toEqual(one);
    expect(one.map((d) => d.slice(0, 10))).toEqual(["2026-10-20", "2026-10-26"]);
  });
});
