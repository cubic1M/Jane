import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));

import { syncItem } from "@/lib/plaid/sync";
import { startTrial } from "@/lib/trial";
import { wholePictureReply } from "./whole-picture";
import { rankedFor } from "./priorities";
import { loadSnapshot } from "./snapshot";
import {
  beginBuild,
  loadSnapshotFast,
  markSnapshotStale,
  mayPublish,
  reviveDates,
  saveSnapshot,
} from "./snapshot-store";
import { stubTestKeys } from "@/lib/__fixtures__/env";

// Jane's snapshot, saved after the first scan and read back in one query by the agenda and the
// chat's tools, instead of every sector being looked up again for each question.

const url = process.env.TEST_DATABASE_URL;
const NOW = new Date("2026-10-18T15:00:00Z");

describe("reviving dates", () => {
  it("turns only date-named ISO text back into dates", () => {
    const iso = "2026-10-18T15:00:00.000Z";
    expect(reviveDates("createdAt", iso)).toEqual(new Date(iso));
    expect(reviveDates("completedAt", iso)).toEqual(new Date(iso));
    expect(reviveDates("title", iso)).toBe(iso);
    expect(reviveDates("date", "2026-10-18")).toBe("2026-10-18");
    expect(reviveDates("createdAt", "not a date")).toBe("not a date");
  });
});

// CodeRabbit part 2: an older build that finishes after a newer one has published must not write
// the older snapshot back over it.
describe("overlapping builds", () => {
  it("lets the newer build's snapshot stand when the older one finishes last", () => {
    const older = beginBuild("overlap-user");
    const newer = beginBuild("overlap-user");
    expect(mayPublish("overlap-user", newer)).toBe(true);
    expect(mayPublish("overlap-user", older)).toBe(false);
  });
  it("lets an older build publish while no newer one has", () => {
    const older = beginBuild("overlap-user-2");
    beginBuild("overlap-user-2");
    expect(mayPublish("overlap-user-2", older)).toBe(true);
  });
});

describe.runIf(url)("the saved snapshot", { timeout: 120_000 }, () => {
  let client: PrismaClient;
  let userId: string;

  beforeAll(async () => {
    stubTestKeys();
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
    const trial = await startTrial({ client, now: NOW, defer: true, person: "family" });
    userId = trial.userId;
    await syncItem(trial.itemId, { client, now: NOW, progressive: true });
  }, 120_000);
  afterAll(async () => {
    await client.user.deleteMany({ where: { id: userId } });
    await client.$disconnect();
    vi.unstubAllEnvs();
  });

  it("is saved when the first scan finishes, and answers the same as a fresh one", async () => {
    const fresh = await loadSnapshot(userId, { client, now: NOW });
    const saved = await loadSnapshotFast(userId, { client, now: NOW });
    expect(saved).not.toBeNull();
    // The answers built from either are the same words.
    expect(wholePictureReply(saved, rankedFor(saved!), "now").body).toBe(
      wholePictureReply(fresh, rankedFor(fresh!), "now").body,
    );
    expect(saved!.findings.map((f) => f.findingId).sort()).toEqual(
      fresh!.findings.map((f) => f.findingId).sort(),
    );
  });

  it("is read back in one query: the same snapshot even when the data has moved on", async () => {
    const before = await loadSnapshotFast(userId, { client, now: NOW });
    await client.finding.deleteMany({ where: { userId } });
    const read = await loadSnapshotFast(userId, { client, now: new Date(NOW.getTime() + 60_000) });
    expect(read!.findings.length).toBe(before!.findings.length);
  });

  it("is old after a tap, still answers at once, and is rebuilt behind it", async () => {
    await markSnapshotStale(userId, { client });
    const later = new Date(NOW.getTime() + 120_000);
    const answered = await loadSnapshotFast(userId, { client, now: later });
    expect(answered).not.toBeNull();
    // Rebuilt behind it: with the findings gone, the new copy has none.
    await vi.waitFor(
      async () => {
        const row = await client.janePreference.findFirstOrThrow({
          where: { userId, kind: "system", key: "snapshot" },
        });
        const at = new Date((row.value as { at: string }).at);
        expect(at.getTime()).toBe(later.getTime());
        expect(
          (row.value as unknown as { snapshot: { findings: unknown[] } }).snapshot.findings,
        ).toHaveLength(0);
      },
      { timeout: 60_000, interval: 250 },
    );
  });

  it("is built fresh on a new day", async () => {
    const tomorrow = new Date(NOW.getTime() + 24 * 3_600_000);
    const built = await loadSnapshotFast(userId, { client, now: tomorrow });
    expect(built!.asOf).toBe(tomorrow.toISOString().slice(0, 10));
  });

  // CodeRabbit part 2: the stamp saved is the one read before the build, not whatever the data is
  // by the time it is saved.
  it("saves the stamp the caller read before building, not a newer one", async () => {
    const built = await loadSnapshot(userId, { client, now: NOW });
    await saveSnapshot(userId, built, { client, now: NOW, stamp: "read-before-the-build" });
    const row = await client.janePreference.findFirstOrThrow({
      where: { userId, kind: "system", key: "snapshot" },
    });
    expect((row.value as { stamp: string }).stamp).toBe("read-before-the-build");
  });
});
