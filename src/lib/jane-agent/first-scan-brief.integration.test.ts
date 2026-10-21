import { randomBytes } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));
// The suggestion scan finds nothing yet, as on a first scan that hasn't got there.
vi.mock("@/lib/suggestions", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/suggestions")>()),
  scanSuggestions: vi.fn(async () => ({ fired: 0, selected: [] })),
}));

import { linkDemoBank } from "@/lib/plaid/demo";
import { syncItem } from "@/lib/plaid/sync";
import { runJaneAgent } from "./run";

// Spec step 265: while a person's first scan is still running and there are no suggestions
// yet, the old brief is not posted; the scan's last run posts what there is.

const url = process.env.TEST_DATABASE_URL;
const NOW = new Date("2026-10-18T15:00:00Z");

describe.runIf(url)("the brief during a first scan", { timeout: 120_000 }, () => {
  let client: PrismaClient;
  let userId: string;
  beforeAll(async () => {
    vi.stubEnv("TOKEN_ENCRYPTION_KEY", randomBytes(32).toString("base64"));
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
    userId = (
      await client.user.create({ data: { email: `fs-${crypto.randomUUID()}@example.com` } })
    ).id;
    const { itemId } = await linkDemoBank(userId, { client, now: NOW });
    await syncItem(itemId, { client, now: NOW, api: {} as never });
  });
  afterAll(async () => {
    await client.user.deleteMany({ where: { id: userId } });
    await client.$disconnect();
    vi.unstubAllEnvs();
  });

  it("posts nothing before the scan's last run, then the brief", async () => {
    await client.janeMessage.deleteMany({ where: { userId } });
    await client.user.update({ where: { id: userId }, data: { firstScanDoneAt: null } });
    expect(await runJaneAgent(userId, { client, now: NOW, trigger: "sync" })).toEqual({
      posted: 0,
    });
    expect(await client.janeMessage.count({ where: { userId } })).toBe(0);

    const last = await runJaneAgent(userId, { client, now: NOW, trigger: "sync", final: true });
    expect(last.posted).toBeGreaterThan(0);
    expect(
      await client.janeMessage.count({
        where: { userId, kind: "brief", body: { contains: "Good" } },
      }),
    ).toBeGreaterThan(0);
  });
});
