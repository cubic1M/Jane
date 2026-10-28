import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));

import { scopedFor } from "@/lib/db-scoped";
import { saveProblemReport } from "./problem-reports";

// Reports against a real, migrated Postgres (see src/detection/engine.integration.test.ts): the
// person's own, and gone with them (a trial person's too).
const url = process.env.TEST_DATABASE_URL;

describe.runIf(url)("problem reports, against a real database", () => {
  let client: PrismaClient;
  beforeAll(() => {
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  });
  afterAll(async () => {
    await client.$disconnect();
  });

  it("are the person's own, and go when they do", async () => {
    const make = async (id: string) =>
      (await client.user.create({ data: { id, email: `${id}@example.com` } })).id;
    const me = await make(`trial_${crypto.randomUUID()}`);
    const other = await make(`rep-${crypto.randomUUID()}`);
    await saveProblemReport(scopedFor(me, client), { path: "/home", message: "Blank chart." });
    await saveProblemReport(scopedFor(other, client), { path: "/import", message: "Slow." });

    expect(
      (await scopedFor(me, client).problemReports.findMany({ select: { message: true } })).map(
        (r) => r.message,
      ),
    ).toEqual(["Blank chart."]);

    await client.user.delete({ where: { id: me } });
    expect(await client.problemReport.count({ where: { userId: me } })).toBe(0);
    await client.user.delete({ where: { id: other } });
  });
});
