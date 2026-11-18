import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));

import { stubTestKeys } from "@/lib/__fixtures__/env";
import { sendToJane } from "./typing";

// Debugger 11-18 (r342, Plaid S5: a month of a new checking account, $700 by Zelle to Maya Chen on
// Nov 1 with "RENT" on the line): "when is my rent due?" answered "You spent $0.00 on Rent and
// utilities in November 2026 so far". One payment is no schedule yet, and a month's spending isn't
// when something is due: the answer says what's missing.

const url = process.env.TEST_DATABASE_URL;
const NOW = new Date("2026-11-18T09:50:00Z");

describe.runIf(url)("when rent is due, with one payment so far", () => {
  let client: PrismaClient;
  let userId = "";
  beforeAll(async () => {
    stubTestKeys();
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url! }) });
    const user = await client.user.create({
      data: {
        email: `rent-not-regular-yet-${crypto.randomUUID()}@example.com`,
        timezone: "America/Los_Angeles",
      },
    });
    userId = user.id;
    const account = await client.account.create({
      data: {
        userId,
        source: "plaid",
        name: "Plaid checking",
        type: "depository",
        subtype: "checking",
        currentBalanceCents: 86_000,
      },
    });
    await client.transaction.create({
      data: {
        userId,
        accountId: account.id,
        source: "plaid",
        dedupeKey: "rent",
        date: new Date("2026-11-01T12:00:00Z"),
        amountCents: 70_000,
        description: "ZELLE TO MAYA CHEN RENT",
        merchantName: null,
        pfcPrimary: "TRANSFER_OUT",
        pfcDetailed: "TRANSFER_OUT_ACCOUNT_TRANSFER",
        categorySource: "plaid",
      },
    });
  });
  afterAll(async () => {
    await client.user.deleteMany({ where: { id: userId } });
    await client.$disconnect();
  });

  it("says there's no schedule yet, not a month's spending", async () => {
    const body = (await sendToJane(userId, "when is my rent due?", { client, now: NOW })).reply
      .body;
    expect(body).not.toMatch(/\$0\.00/);
    expect(body).toMatch(/^I don't see a regular rent payment yet/);
  });
});
