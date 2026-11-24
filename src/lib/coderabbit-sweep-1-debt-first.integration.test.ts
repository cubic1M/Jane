import { randomBytes } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));

import { debtFirst } from "./debt-first";

// CodeRabbit sweep 1, src/lib helpers: a card in credit owes nothing.
const url = process.env.TEST_DATABASE_URL;

describe.runIf(url)("debt first, against a real database", () => {
  let client: PrismaClient;
  const ids: string[] = [];
  beforeAll(() => {
    vi.stubEnv("AUTH_SECRET", "test-secret");
    vi.stubEnv("TOKEN_ENCRYPTION_KEY", randomBytes(32).toString("base64"));
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  });
  afterAll(async () => {
    await client.user.deleteMany({ where: { id: { in: ids } } });
    await client.$disconnect();
    vi.unstubAllEnvs();
  });

  async function personWithCard(currentBalanceCents: number) {
    const user = await client.user.create({
      data: { email: `debt-first-${crypto.randomUUID()}@example.com` },
    });
    ids.push(user.id);
    const card = await client.account.create({
      data: { userId: user.id, source: "csv", name: "Card", type: "credit", currentBalanceCents },
    });
    await client.liability.create({
      data: { userId: user.id, accountId: card.id, kind: "credit", aprBps: 2_400 },
    });
    return user.id;
  }

  it("says nothing for a card with a credit balance, however large", async () => {
    expect(await debtFirst(await personWithCard(-500_000), client)).toBeNull();
  });
  it("still says it for a card that is owed", async () => {
    expect(await debtFirst(await personWithCard(500_000), client)).toMatch(
      /carrying debt at up to 24% a year/,
    );
  });
});
