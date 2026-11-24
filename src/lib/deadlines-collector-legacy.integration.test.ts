import { randomBytes } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));

import { DEADLINE_SOURCES, addDeadline, listDeadlines } from "./deadlines";

// CodeRabbit sweep 1: validation letters no longer put a collector answer date on the list, and
// the ones put there before don't stay on it.
const url = process.env.TEST_DATABASE_URL;
const NOW = new Date("2026-10-18T12:00:00Z");

describe.runIf(url)("the deadlines list and old collector answer dates", () => {
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

  it("leaves out an open collector validation row and keeps the rest", async () => {
    const user = await client.user.create({
      data: { email: `legacy-${crypto.randomUUID()}@example.com` },
    });
    ids.push(user.id);
    const add = (title: string) =>
      addDeadline(
        user.id,
        { title, dueOn: "2026-10-30", kind: "other", note: "" },
        { client, now: NOW },
      );
    await add("Collector's validation due: Northstar Recovery");
    await add("Bureaus' answer due: Northstar Recovery");
    const rows = await listDeadlines(user.id, { client, now: NOW, sources: [DEADLINE_SOURCES[2]] });
    expect(rows.map((r) => r.title)).toEqual(["Bureaus' answer due: Northstar Recovery"]);
  });
});
