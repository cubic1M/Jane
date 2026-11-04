import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";
import { saveTryFeedback } from "./try-feedback";
import { countTry, tryTotals } from "./try-stats";

// Against a real, migrated Postgres (see src/detection/engine.integration.test.ts). In a far year,
// so a try another test file starts at the same moment isn't counted in the window here.
const url = process.env.TEST_DATABASE_URL;
const now = new Date("2041-11-04T12:00:00Z");
const MARK = "try-stats-test";

describe.runIf(url)("try counts and feedback, against a real database", () => {
  let client: PrismaClient;
  beforeAll(() => {
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  });
  afterAll(async () => {
    await client.$executeRaw`DELETE FROM try_stats WHERE day >= '2041-01-01'`;
    await client.$executeRaw`DELETE FROM try_feedback WHERE message LIKE ${`${MARK}%`}`;
    await client.$disconnect();
  });

  it("adds up by day and event, over a window of 7 UTC days", async () => {
    await countTry("started", { client, now });
    await countTry("started", { client, now });
    await countTry("started", { client, now: new Date("2041-10-29T12:00:00Z") });
    await countTry("started", { client, now: new Date("2041-10-28T23:00:00Z") });
    await countTry("scan_failed", { client, now });
    const totals = await tryTotals({ client, now });
    expect(totals.find((t) => t.event === "started")?.lastWeek).toBe(3);
    expect(totals.find((t) => t.event === "started")?.allTime).toBeGreaterThanOrEqual(4);
    expect(totals.find((t) => t.event === "scan_failed")?.lastWeek).toBe(1);
    expect(totals.find((t) => t.event === "needs_columns")?.lastWeek).toBe(0);
  });

  it("holds no person: the tables have no column for one", async () => {
    const columns = await client.$queryRaw<{ column_name: string }[]>`
      SELECT column_name FROM information_schema.columns
      WHERE table_name IN ('try_stats', 'try_feedback')`;
    const names = columns.map((c) => c.column_name);
    expect(names).toContain("message");
    for (const name of names) expect(name).not.toMatch(/user|person|actor|ip|session|email/);
  });

  it("saves feedback scrubbed, and says which kind of try it was", async () => {
    await saveTryFeedback(
      "trial_own_someone",
      { path: "/home", message: `${MARK} me@example.com wrong` },
      { client },
    );
    await saveTryFeedback("trial_sample", { path: "/home", message: `${MARK} wrong` }, { client });
    const rows = await client.tryFeedback.findMany({
      where: { message: { startsWith: MARK } },
      orderBy: { message: "asc" },
    });
    expect(rows.map((r) => [r.message, r.kind])).toEqual([
      [`${MARK} [email] wrong`, "statement"],
      [`${MARK} wrong`, "sample"],
    ]);
  });
});
