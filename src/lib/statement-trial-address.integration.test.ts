import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

const address = vi.hoisted(() => ({ ip: "198.51.100.10" }));
vi.mock("next/headers", () => ({
  headers: async () => new Headers({ "x-forwarded-for": address.ip }),
}));

import {
  STATEMENT_TRIAL_MAX_ROWS,
  STATEMENT_TRIAL_ROWS_AN_ADDRESS,
  STATEMENT_TRIAL_ROWS_A_DAY,
} from "@/config/statement-trial";
import { scopedFor } from "@/lib/db-scoped";
import { deleteTrialPerson } from "@/lib/trial-delete";
import { startStatementPerson, statementUploadRefusal } from "./statement-trial";

// An independent read, then the local build: 10 starts from one address, each with two files of
// 3,000 rows, took the day's counter to 48,000 of 50,000 in five minutes, and someone else's first
// upload got "come back tomorrow".
const url = process.env.TEST_DATABASE_URL;
// Past every other test file's clock, since the day's counter is shared.
const NOW = new Date("2034-05-09T15:00:00Z");

describe.runIf(url)("what one address may add of the day's statement rows", () => {
  let client: PrismaClient;
  const people: string[] = [];
  const options = () => ({ client, now: NOW });

  const db = async () => {
    const { userId } = await startStatementPerson({ userAgent: "test", client, now: NOW });
    people.push(userId);
    return scopedFor(userId, client);
  };
  const dayCount = async () =>
    (
      await client.rateLimit.findFirst({
        where: { key: "statementRowsDay:all" },
        orderBy: { windowStart: "desc" },
      })
    )?.count ?? 0;

  beforeAll(() => {
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  });
  beforeEach(async () => {
    await client.rateLimit.deleteMany({ where: { key: { startsWith: "statementRowsAddress:" } } });
    await client.rateLimit.deleteMany({ where: { key: "statementRowsDay:all" } });
    address.ip = "198.51.100.10";
  });
  afterAll(async () => {
    for (const id of people)
      await deleteTrialPerson(id, "failed_start", { client }).catch(() => {});
    await client.$disconnect();
  });

  it("leaves most of the day for everyone else", () => {
    expect(STATEMENT_TRIAL_ROWS_AN_ADDRESS).toBeLessThanOrEqual(STATEMENT_TRIAL_ROWS_A_DAY / 4);
    expect(STATEMENT_TRIAL_ROWS_AN_ADDRESS).toBeGreaterThanOrEqual(3 * STATEMENT_TRIAL_MAX_ROWS);
  });

  it("stops one address at its share, and someone else still gets in", async () => {
    const files = [{ rows: STATEMENT_TRIAL_MAX_ROWS }];
    // 12,000 rows, in the largest files there are.
    for (let i = 0; i < 4; i++) {
      expect(await statementUploadRefusal(await db(), files, options())).toBeNull();
    }
    const counted = await dayCount();
    const refused = await db();
    expect(await statementUploadRefusal(refused, files, options())).toMatch(/from here today/);
    // Refused takes nothing from the day or from that person.
    expect(await dayCount()).toBe(counted);
    expect(await statementUploadRefusal(refused, [{ rows: 0 }], options())).toBeNull();

    address.ip = "203.0.113.20";
    expect(await statementUploadRefusal(await db(), files, options())).toBeNull();
  });

  it("gives back the address's share when the day has none left", async () => {
    const person = await db();
    await client.rateLimit.create({
      data: {
        key: "statementRowsDay:all",
        windowStart: new Date("2034-05-09T00:00:00Z"),
        count: STATEMENT_TRIAL_ROWS_A_DAY,
      },
    });
    expect(await statementUploadRefusal(person, [{ rows: 10 }], options())).not.toBeNull();
    const row = await client.rateLimit.findFirst({
      where: { key: { startsWith: "statementRowsAddress:" } },
    });
    expect(row?.count ?? 0).toBe(0);
  });

  it("counts nothing for a preview, which keeps nothing", async () => {
    const person = await db();
    const look = { ...options(), charge: false };
    expect(await statementUploadRefusal(person, [{ rows: 3_000 }], look)).toBeNull();
    expect(await statementUploadRefusal(person, [{ rows: 3_000 }], look)).toBeNull();
    expect(await statementUploadRefusal(person, [{ rows: 3_000 }], look)).toBeNull();
    expect(await dayCount()).toBe(0);
    // The upload after it still has the whole allowance.
    expect(await statementUploadRefusal(person, [{ rows: 3_000 }], options())).toBeNull();
    expect(await statementUploadRefusal(person, [{ rows: 3_000 }], options())).toBeNull();
    expect(await statementUploadRefusal(person, [{ rows: 1 }], options())).toMatch(/holds up to/);
  });
});
