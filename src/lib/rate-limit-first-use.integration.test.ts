import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";
import { firstUseInWindow } from "./rate-limit";

const url = process.env.TEST_DATABASE_URL;

describe.runIf(url)("firstUseInWindow", () => {
  let client: PrismaClient;
  const subject = `first-use-${crypto.randomUUID()}`;

  beforeAll(() => {
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  });
  afterAll(async () => {
    await client.rateLimit.deleteMany({ where: { key: { endsWith: subject } } });
    await client.$disconnect();
  });

  // Fixed windows: a two-factor code used at the end of one was good again at the start of the next.
  it("holds across a window's edge, then lets go", async () => {
    const at = (minutes: number, seconds = 0) =>
      new Date(Date.UTC(2031, 0, 1, 12, minutes, seconds));
    const use = (now: Date) => firstUseInWindow("mfaCodeUsed", subject, { client, now });
    expect(await use(at(2, 59))).toBe(true);
    expect(await use(at(2, 59))).toBe(false);
    expect(await use(at(3, 1))).toBe(false);
    expect(await use(at(9, 1))).toBe(true);
  });
});
