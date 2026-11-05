import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));

import { answerUnusual } from "./unusual";

// A read of everything Jane says it did or will do: on a real person's "Not me", Jane said our team
// asks the card for the money back. There's no team, the card it opened goes at the next scan, and
// the alert was closed, so nothing asked again while the time to dispute ran.
const url = process.env.TEST_DATABASE_URL;

describe.runIf(url)("a real person saying a charge isn't theirs", () => {
  let client: PrismaClient;
  let userId: string;
  beforeAll(async () => {
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
    ({ id: userId } = await client.user.create({
      data: { email: `unusual-real-${crypto.randomUUID()}@example.com` },
    }));
    await client.account.create({
      data: { userId, source: "csv", name: "Real card", type: "credit" },
    });
  });
  afterAll(async () => {
    await client.user.deleteMany({ where: { id: userId } });
    await client.$disconnect();
  });

  it("is told to call the card company, and no card promises otherwise", async () => {
    const { id } = await client.alert.create({
      data: {
        userId,
        type: "unusual_activity",
        key: "unusual:merchant-x:large:2026-11-01",
        title: "Unusual charge of $500.00 at Merchant X",
        body: "Much more than usual.",
      },
    });
    const outcome = await answerUnusual(userId, id, "not_me", { client });
    expect(outcome.note).toMatch(/Call your card company/);
    expect(outcome.note).not.toMatch(/team/);
    expect(await client.finding.count({ where: { userId } })).toBe(0);
  });
});
