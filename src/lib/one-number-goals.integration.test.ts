import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PEOPLE, type PersonId } from "@/config/people";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));

import { stubTestKeys } from "@/lib/__fixtures__/env";
import { loadMoneyArea } from "@/lib/area-pages/money-load";
import { loadPlansArea } from "@/lib/area-pages/plans-load";
import { loadHubAreas } from "@/lib/hub/load";
import { tilesView } from "@/lib/hub/view";
import { loadMoneyHub } from "@/lib/hubs/money";
import { linkDemoBank } from "@/lib/plaid/demo";
import { syncItem } from "@/lib/plaid/sync";

// Gate B, "one number, one source" (docs/one-number.md): "N of M goals on track" is one count on
// Home's Plans tile, the Money page, the money hub and the Plans tree. The first three counted every
// goal whose date hadn't passed (late or not, reached or not); the tree counted the goals not reached,
// on the way and in time with the others. Now all four count the tree's way (goalsOnTrack).

const url = process.env.TEST_DATABASE_URL;
const NOW = new Date("2026-11-04T17:00:00Z");

describe.runIf(url)("goals on track, one count", { timeout: 300_000 }, () => {
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

  const user = async (name: string) => {
    const row = await client.user.create({
      data: { email: `one-number-goals-${name}@example.com`, timezone: "America/Los_Angeles" },
    });
    made.push(row.id);
    return row.id;
  };

  // "N of M" as each surface says it.
  const counts = async (userId: string) => {
    const o = { client, now: NOW };
    const [areas, money, hub, plans] = await Promise.all([
      loadHubAreas(userId, { budgetsOver: 0, safeShort: false }, o),
      loadMoneyArea(userId, o),
      loadMoneyHub(userId, o),
      loadPlansArea(userId, o),
    ]);
    const tile = tilesView(areas).find((t) => t.key === "ahead")!.value;
    // The tree's goal items (itemId "goals:<goal id>"): one not reached and marked good is on track.
    const open = new Set(
      plans.goals.filter((g) => g.progress.status !== "reached").map((g) => `goals:${g.id}`),
    );
    const items = plans.area.tree.branches.flatMap((b) => b.items).filter((i) => open.has(i.id));
    return {
      "home tile": tile,
      "money page": `${money!.have.goals.onTrack} of ${money!.have.goals.total}`,
      "money hub": `${hub.goals.onTrack} of ${hub.goals.total}`,
      "plans tree": `${items.filter((i) => i.status === "good").length} of ${items.length}`,
    };
  };

  it.each(PEOPLE.map((p) => p.id))("%s: one count of goals on track", async (id) => {
    const userId = await user(id);
    const { itemId } = await linkDemoBank(userId, { client, now: NOW, person: id as PersonId });
    await syncItem(itemId, { client, now: NOW });
    const shown = await counts(userId);
    const tree = shown["plans tree"];
    expect(shown).toEqual({
      "home tile": tree === "0 of 0" ? shown["home tile"] : tree,
      "money page": tree,
      "money hub": tree,
      "plans tree": tree,
    });
  });

  it("doesn't count a goal whose date has passed, or a reached one, as on track", async () => {
    const userId = await user("hand-built");
    await client.savingsGoal.createMany({
      data: [
        // Reached; on the way; date passed.
        {
          userId,
          name: "Laptop",
          targetCents: 100_000,
          manualSavedCents: 100_000,
          targetDate: new Date("2027-03-01T00:00:00Z"),
        },
        {
          userId,
          name: "Trip",
          targetCents: 200_000,
          manualSavedCents: 50_000,
          targetDate: new Date("2027-08-01T00:00:00Z"),
        },
        {
          userId,
          name: "Bike",
          targetCents: 80_000,
          manualSavedCents: 10_000,
          targetDate: new Date("2026-10-01T00:00:00Z"),
        },
      ],
    });
    expect(await counts(userId)).toEqual({
      "home tile": "1 of 2",
      "money page": "1 of 2",
      "money hub": "1 of 2",
      "plans tree": "1 of 2",
    });
  });
});
