import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));

import { stubTestKeys } from "@/lib/__fixtures__/env";
import type { Snapshot } from "./snapshot";
import { loadSnapshotFast, saveSnapshot } from "./snapshot-store";

// Gate C's calendar sweep (src/sweep/), 11-16: the saved snapshot was "today's" by UTC's day. At
// 3pm in Los Angeles the chat still answered from the copy saved at 7pm the evening before (UTC
// had already moved on then), so "what should I do first" said "it can't wait long" in the
// afternoon and "it's due in 3 days" in the evening, and the copy saved at 3pm was thrown away at
// 4pm. The person's own day decides.

const url = process.env.TEST_DATABASE_URL;
// 7pm on Nov 15, 3pm and 7pm on Nov 16 in Los Angeles.
const EVENING_BEFORE = new Date("2026-11-16T03:00:00Z");
const AFTERNOON = new Date("2026-11-16T23:00:00Z");
const EVENING = new Date("2026-11-17T03:00:00Z");

describe.runIf(url)("the saved snapshot on the person's own day", { timeout: 120_000 }, () => {
  let client: PrismaClient;
  const made: string[] = [];
  beforeAll(() => {
    stubTestKeys();
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url! }) });
  });
  afterAll(async () => {
    await client.user.deleteMany({ where: { id: { in: made } } });
    await client.$disconnect();
    vi.unstubAllEnvs();
  });

  async function person() {
    const user = await client.user.create({
      data: { email: `snapshot-day-${made.length}@example.test`, timezone: "America/Los_Angeles" },
    });
    made.push(user.id);
    return user.id;
  }
  const savedAt = async (userId: string) =>
    (
      (
        await client.janePreference.findFirstOrThrow({
          where: { userId, kind: "system", key: "snapshot" },
        })
      ).value as { at: string }
    ).at;
  // A saved copy that says which day it was built for.
  const saved = (asOf: string) => ({ asOf, marker: "saved" }) as unknown as Snapshot;

  it("doesn't answer this afternoon from last evening's copy", async () => {
    const userId = await person();
    await saveSnapshot(userId, saved("2026-11-15"), { client, now: EVENING_BEFORE });
    const read = await loadSnapshotFast(userId, { client, now: AFTERNOON });
    // Built here for today (a person with no data has none), and saved as this afternoon's.
    expect((read as unknown as { marker?: string } | null)?.marker).toBeUndefined();
    expect(await savedAt(userId)).toBe(AFTERNOON.toISOString());
  });

  it("answers this evening from this afternoon's copy", async () => {
    const userId = await person();
    await saveSnapshot(userId, saved("2026-11-16"), { client, now: AFTERNOON });
    const read = await loadSnapshotFast(userId, { client, now: EVENING });
    expect((read as unknown as { marker?: string }).marker).toBe("saved");
    // It is hours old, so it is rebuilt behind the answer: let that finish before cleaning up.
    await vi.waitFor(async () => expect(await savedAt(userId)).toBe(EVENING.toISOString()), {
      timeout: 60_000,
      interval: 250,
    });
  });
});
