import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));

import { track } from "@/lib/analytics";
import { addDeadline, markDeadlineDone } from "./deadlines";

// CodeRabbit sweep 1c (lib-02, multi-year 4): a deadline that was saved isn't reported as failed
// because its analytics row failed, so a retry doesn't make a second one.

const url = process.env.TEST_DATABASE_URL;
const NOW = new Date("2026-11-18T19:00:00Z");

describe.runIf(url)("deadlines when analytics fails", { timeout: 60_000 }, () => {
  let client: PrismaClient;
  let userId = "";
  beforeAll(async () => {
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
    userId = (
      await client.user.create({
        data: { email: `deadline-track-${crypto.randomUUID()}@example.com` },
      })
    ).id;
  });
  afterAll(async () => {
    await client.user.deleteMany({ where: { id: userId } });
    await client.$disconnect();
  });

  it("saves the deadline once and still resolves", async () => {
    vi.mocked(track).mockRejectedValueOnce(new Error("analytics down"));
    const id = await addDeadline(
      userId,
      { title: "Rebalance", dueOn: "2026-12-01", kind: "other", note: "" },
      { client, now: NOW },
    );
    expect(await client.deadline.count({ where: { userId } })).toBe(1);
    // The id of the deadline just made, so a caller never looks one up by title and date.
    expect(id).toBe((await client.deadline.findFirstOrThrow({ where: { userId } })).id);
  });

  it("ticks one off and still resolves", async () => {
    const row = await client.deadline.findFirstOrThrow({ where: { userId } });
    vi.mocked(track).mockRejectedValueOnce(new Error("analytics down"));
    await expect(markDeadlineDone(userId, row.id, { client, now: NOW })).resolves.toBe(true);
  });
});
