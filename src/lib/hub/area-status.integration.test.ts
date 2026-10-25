import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PEOPLE } from "@/config/people";

// The area loaders read the default client: the test database here.
vi.mock("@/lib/db", async () => {
  const { PrismaClient: Client } = await import("@/generated/prisma/client");
  const { PrismaPg: Adapter } = await import("@prisma/adapter-pg");
  return {
    db: new Client({ adapter: new Adapter({ connectionString: process.env.TEST_DATABASE_URL }) }),
  };
});
vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));

import { db } from "@/lib/db";
import { buildFeatureMap, sampleExamples } from "@/lib/feature-map";
import { giantAreas } from "@/lib/giant-tree";
import { syncItem } from "@/lib/plaid/sync";
import { startTrial } from "@/lib/trial";
import { withAreaStatus } from "./area-status";
import { loadAreaTrees } from "./area-trees";
import { loadHubAreas } from "./load";
import { tilesView } from "./view";

// QA round 11: on Home an area's tile and its row in "What Jane does" disagreed (the debt
// person's Insurance: "6 urgent" in the tree, "3 gaps" on the tile). For each of the 8 sample
// people, every area's tile says what its tree says: the same status, the same line.
const url = process.env.TEST_DATABASE_URL;
const NOW = new Date("2026-10-18T15:00:00Z");

describe.runIf(url)("an area's tile and its tree agree", { timeout: 180_000 }, () => {
  const made: string[] = [];
  let compared = 0;

  beforeAll(() => {
    vi.stubEnv("TOKEN_ENCRYPTION_KEY", randomBytes(32).toString("base64"));
    vi.stubEnv("ANTHROPIC_API_KEY", "");
  });
  afterAll(async () => {
    // Areas were compared (the test is not vacuous).
    expect(compared).toBeGreaterThan(PEOPLE.length * 3);
    await db.user.deleteMany({ where: { id: { in: made } } });
    vi.unstubAllEnvs();
  });

  it.each(PEOPLE.map((p) => p.id))(
    "%s: every area's tile has its tree's status and line",
    async (id) => {
      const trial = await startTrial({ client: db, now: NOW, defer: true, person: id });
      made.push(trial.userId);
      await syncItem(trial.itemId, { client: db, now: NOW });

      const trees = await loadAreaTrees(trial.userId);
      const areas = await loadHubAreas(
        trial.userId,
        { budgetsOver: 0, safeShort: false },
        { client: db, now: NOW },
      );
      const tiles = withAreaStatus(tilesView(areas), trees);
      const tree = giantAreas(
        buildFeatureMap({ examples: sampleExamples(), reached: new Set(), advice: true }),
        trees,
      );
      for (const t of tiles) {
        if (!trees[t.key]) continue;
        const row = tree.find((a) => a.key === t.key)!;
        compared += 1;
        expect(t.health, `${id} ${t.key}`).toBe(row.status);
        expect(t.healthWhy, `${id} ${t.key}`).toBe(row.line);
      }
    },
    180_000,
  );
});
