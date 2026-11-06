import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));

import { track } from "@/lib/analytics";
import { recordInviteOpened } from "./share-invites";

// Anyone can load /join/[code], and each load wrote an "invite opened" row to the funnel the team
// reads, with no limit: a script could make any share link look opened a thousand times. It counts
// once a day for each link from each place. Against a real Postgres.

const url = process.env.TEST_DATABASE_URL;
const BROWSER = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0)";

describe.runIf(url)("a share link opened again and again", () => {
  let client: PrismaClient;
  const inviteId = `invite-${crypto.randomUUID()}`;
  beforeAll(() => {
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url! }) });
  });
  afterAll(async () => {
    await client.rateLimit.deleteMany({ where: { key: { contains: inviteId } } });
    await client.$disconnect();
  });

  it("counts once a day from each place", async () => {
    const opened = [];
    for (let i = 0; i < 5; i += 1) {
      opened.push(await recordInviteOpened(inviteId, BROWSER, "place-a", { client }));
    }
    opened.push(await recordInviteOpened(inviteId, BROWSER, "place-b", { client }));
    expect(opened).toEqual([true, false, false, false, false, true]);
    expect(vi.mocked(track).mock.calls.filter(([, name]) => name === "invite_opened")).toHaveLength(
      2,
    );
  });
});
