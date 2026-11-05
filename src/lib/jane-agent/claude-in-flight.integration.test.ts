import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));

import { STILL_ANSWERING_TEXT, claudeFinished, claudeLimit } from "./claude-limits";

// A real person's day is read before an answer and charged after it, so 50 messages at once all
// passed the 20 cents a day. Only so many may be written at once, against a real Postgres.

const url = process.env.TEST_DATABASE_URL;
const NOW = new Date("2031-04-15T12:00:00Z");

describe.runIf(url)("answers being written for one person", { timeout: 60_000 }, () => {
  let client: PrismaClient;
  beforeAll(() => {
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url! }) });
  });
  afterAll(async () => {
    await client.rateLimit.deleteMany({ where: { key: { contains: "in-flight-" } } });
    await client.$disconnect();
  });

  const options = () => ({ client, now: NOW });
  const person = () => `in-flight-${crypto.randomUUID()}`;

  it("lets three through of 50 at once, and tells the rest to wait", async () => {
    const userId = person();
    const limits = await Promise.all(
      Array.from({ length: 50 }, () => claudeLimit(userId, options())),
    );
    expect(limits.filter((l) => l === null)).toHaveLength(3);
    expect(limits.filter((l) => l !== null)).toEqual(
      Array.from({ length: 47 }, () => ({ text: STILL_ANSWERING_TEXT })),
    );
  });

  it("opens a place as each answer finishes, and a refusal doesn't take one", async () => {
    const userId = person();
    for (let i = 0; i < 3; i += 1) expect(await claudeLimit(userId, options())).toBeNull();
    for (let i = 0; i < 5; i += 1) expect(await claudeLimit(userId, options())).not.toBeNull();
    await claudeFinished(userId, options());
    expect(await claudeLimit(userId, options())).toBeNull();
    expect(await claudeLimit(userId, options())).not.toBeNull();
  });

  it("never stops someone asking one thing after another", async () => {
    const userId = person();
    for (let i = 0; i < 12; i += 1) {
      expect(await claudeLimit(userId, options())).toBeNull();
      await claudeFinished(userId, options());
    }
  });
});
