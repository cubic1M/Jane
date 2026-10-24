import { randomBytes } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PEOPLE } from "@/config/people";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));

import { decrypt } from "@/lib/crypto";
import { loadHubAreas } from "@/lib/hub/load";
import { tilesView } from "@/lib/hub/view";
import { runChatTool } from "@/lib/jane-agent/claude-tools";
import { practiceIdeasView } from "@/lib/practice/ideas-view";
import { inputFor } from "@/profile/sample";
import { samplePracticeIdeas } from "@/profile/sample-practice";
import { isTrialUser, startTrial } from "@/lib/trial";
import { syncItem } from "./sync";

// Runs against a real, migrated Postgres (see src/detection/engine.integration.test.ts).
const url = process.env.TEST_DATABASE_URL;
const LINKED = new Date("2026-10-18T15:00:00Z");

describe.runIf(url)(
  "the eight sample people, through the demo bank's sync",
  { timeout: 120_000 },
  () => {
    let client: PrismaClient;
    const made: string[] = [];

    beforeAll(() => {
      vi.stubEnv("TOKEN_ENCRYPTION_KEY", randomBytes(32).toString("base64"));
      vi.stubEnv("ANTHROPIC_API_KEY", "");
      vi.stubEnv("PLAID_CLIENT_ID", "");
      vi.stubEnv("PLAID_SECRET", "");
      client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
    });
    afterAll(async () => {
      await client.user.deleteMany({ where: { id: { in: made } } });
      await client.$disconnect();
      vi.unstubAllEnvs();
    });

    it.each(PEOPLE.map((p) => p.id))(
      "%s signs up as a trial person and syncs like a bank",
      async (id) => {
        const trial = await startTrial({ client, now: LINKED, defer: true, person: id });
        made.push(trial.userId);
        // Trial rules (spec step 138) hold: a trial id, a name from the written description.
        expect(isTrialUser(trial.userId)).toBe(true);
        const user = await client.user.findUniqueOrThrow({ where: { id: trial.userId } });
        expect(user.name).toBe(PEOPLE.find((p) => p.id === id)!.name);
        const item = await client.plaidItem.findUniqueOrThrow({ where: { id: trial.itemId } });
        expect(decrypt(item.accessTokenEncrypted)).toMatch(
          new RegExp(`^demo:[a-f0-9]{16}:2026-10-18:${id}$`),
        );
        const result = await syncItem(trial.itemId, { client, now: LINKED });
        expect(result.firstSync).toBe(true);
        expect(result.added).toBeGreaterThan(200);
        expect(
          await client.account.count({ where: { userId: trial.userId } }),
        ).toBeGreaterThanOrEqual(3);

        // Phase AW: the practice portfolio started by itself, weeks back, with trades to see,
        // on the hub's Investing tile, on /investments and in the chat.
        const userId = trial.userId;
        const portfolio = await client.practicePortfolio.findFirstOrThrow({ where: { userId } });
        expect(portfolio.startedAt.getTime()).toBeLessThan(LINKED.getTime() - 14 * 86_400_000);
        expect(
          await client.practiceTrade.count({ where: { userId, side: { in: ["buy", "sell"] } } }),
        ).toBeGreaterThan(0);
        const areas = await loadHubAreas(
          userId,
          { budgetsOver: 0, safeShort: false },
          { client, now: LINKED },
        );
        const tile = tilesView(areas).find((t) => t.key === "investments")!;
        expect(tile.healthWhy).not.toBe("Not set up");
        expect(tile.caption).toMatch(/^Practice money/);
        const view = await practiceIdeasView(userId, { client, now: LINKED });
        expect(view.strategy?.label).toBeTruthy();
        const chat = JSON.parse(
          (await runChatTool(userId, "practice_portfolio", {}, { client, now: LINKED })).content,
        );
        expect(chat.positions.length).toBeGreaterThan(0);
        expect(chat.strategyToday?.strategy).toBeTruthy();
        // The ideas waiting are the ones the detector harness replays for them (same settings,
        // same days, the same scan). The two kinds that read the drop they said they could take
        // need their investor profile, so they count only once it is there.
        const profiled = (await client.investorProfile.count({ where: { userId } })) > 0;
        const needsProfile = (k: string) =>
          !profiled && (k === "risk_mismatch" || k === "max_drop_near");
        const harness = samplePracticeIdeas(id, { ...inputFor(id), today: "2026-10-18" })
          .map((i) => i.kind)
          .filter((k) => !needsProfile(k));
        expect([...new Set(view.ideas.map((i) => i.kind))].sort()).toEqual(
          [...new Set(harness)].sort(),
        );
      },
    );
  },
);
