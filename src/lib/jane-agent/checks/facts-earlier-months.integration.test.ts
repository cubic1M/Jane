import { randomBytes } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

// Linking the demo bank writes its audit row through the app's own client: the same database.
vi.hoisted(() => {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? "";
});
vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));

import { runChatTool } from "../claude-tools";
import { loadFacts } from "./facts";
import { createCheckPerson, deleteCheckPerson } from "./person";

// The live run's grader holds Claude's answer to the figures Jane's lookups give (facts.ts). The
// lookups ran with no input, so the spending tool gave this month only, and a right answer about
// last month's groceries ("$281.13 went on groceries" in October) was marked as made up (live
// real-account run, 11-12). The grader now has each month's figures.
const url = process.env.TEST_DATABASE_URL;

describe.runIf(url)("the grader's figures", () => {
  let client: PrismaClient;
  let id = "";
  const now = new Date("2026-11-12T18:00:00Z");
  beforeAll(async () => {
    vi.stubEnv("TOKEN_ENCRYPTION_KEY", randomBytes(32).toString("base64"));
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url! }) });
    id = await createCheckPerson({ client, now, person: "renter", ownAccount: true });
  }, 120_000);
  afterAll(async () => {
    if (id) await deleteCheckPerson(id, { client });
    await client.$disconnect();
  });

  it("include last month's spending by category and its parts", async () => {
    const facts = await loadFacts(id, { client, now });
    const october = await runChatTool(
      id,
      "spending_by_category",
      { month: "2026-10" },
      {
        client,
        now,
      },
    );
    expect(october.cents.length).toBeGreaterThan(0);
    for (const cents of october.cents) expect(facts.allowedCents).toContain(cents);
  }, 120_000);
});
