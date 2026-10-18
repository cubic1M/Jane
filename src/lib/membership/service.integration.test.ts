import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn() }));

import { track } from "@/lib/analytics";
import { dismissOffer, offerFor, recordPaidMembership, reserveMembership } from "./service";

// Runs against a real, migrated Postgres (see src/detection/engine.integration.test.ts).
const url = process.env.TEST_DATABASE_URL;

describe.runIf(url)("membership against a real database", () => {
  let client: PrismaClient;
  let userId: string;

  beforeAll(async () => {
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
    userId = (
      await client.user.create({ data: { email: `member-${crypto.randomUUID()}@example.com` } })
    ).id;
    const finding = await client.finding.create({
      data: {
        userId,
        type: "bank_fees",
        key: "k",
        title: "Fees",
        confidence: "high",
        status: "done",
      },
    });
    const decision = await client.decision.create({
      data: {
        userId,
        findingId: finding.id,
        choice: "yes",
        cardSnapshot: { title: "Fees", annualSavingsCents: 3500 },
      },
    });
    await client.action.create({
      data: {
        userId,
        decisionId: decision.id,
        type: "recover_bank_fees",
        status: "done",
        completedAt: new Date(),
      },
    });
  });

  afterAll(async () => {
    await client.user.deleteMany({ where: { id: userId } });
    await client.$disconnect();
  });

  it("offers membership after a finished action, and 'not now' hides it", async () => {
    expect((await offerFor(userId, { client })).show).toBe(true);

    await dismissOffer(userId, { client });

    expect((await offerFor(userId, { client })).show).toBe(false);
    const in15Days = new Date(Date.now() + 15 * 24 * 60 * 60 * 1000);
    expect((await offerFor(userId, { client, now: in15Days })).show).toBe(true);
  });

  it("records a reservation once", async () => {
    await reserveMembership(userId, { client });
    await reserveMembership(userId, { client });

    expect(await client.membershipIntent.count({ where: { userId, kind: "reserve" } })).toBe(1);
    expect(await offerFor(userId, { client })).toEqual({ show: false, member: "reserved" });
  });

  it("records a Stripe test-mode payment as a paid intent, once per session", async () => {
    const session = { id: `cs_test_${crypto.randomUUID()}`, userId, amountCents: 4900 };

    expect(await recordPaidMembership(session, { client })).toBe(true);
    expect(await recordPaidMembership(session, { client })).toBe(true);

    const paid = await client.membershipIntent.findMany({ where: { userId, kind: "paid" } });
    expect(paid).toEqual([
      expect.objectContaining({ stripeSessionId: session.id, amountCents: 4900 }),
    ]);
    expect(vi.mocked(track).mock.calls.filter((c) => c[1] === "membership_paid")).toHaveLength(1);
  });

  it("ignores a payment for an unknown user", async () => {
    expect(
      await recordPaidMembership({ id: "cs_x", userId: "nobody", amountCents: 1 }, { client }),
    ).toBe(false);
  });
});
