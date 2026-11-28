import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));

import { loadHubTop } from "@/lib/hub/load";
import { NO_PLAID as plaid } from "@/lib/__fixtures__/plaid";
import { stubTestKeys } from "@/lib/__fixtures__/env";
import { loadComingUp } from "@/lib/coming-up";
import { linkDemoBank } from "@/lib/plaid/demo";
import { syncItem } from "@/lib/plaid/sync";
import { practiceCards } from "@/lib/practice/cards";
import { withRequestMemo } from "@/lib/read-memo";
import { openChat } from "./open";
import { runJaneAgent } from "./run";
import { pinnedMessages } from "./messages";
import { loadPopupStack } from "./popup-stack";

// Founder, 11-28: "it is taking way longer to load the chat and suggestions". Every database query a
// page makes is a round trip (about 6 ms from Vercel to the database, 283 of them for Home), so the
// number of queries is the time. This counts them for what opening Home, the side chat and the card
// dock load, for the demo person (about 560 transactions, 27 suggestions, 16 cards), and fails when
// one of them grows past its budget: add a loader that asks again for what a page already has and
// this goes red, not the founder's afternoon.
//
// Counted as Prisma queries on a person's rows, each load inside withRequestMemo (a page render shares
// its reads the same way, src/lib/read-memo.ts: a repeated question has one answer). The budgets
// are the counts measured on 11-28 (dock 53, chat 74, Home's top 129) plus about a tenth. Never to
// be raised without saying why in the pull request.

const url = process.env.TEST_DATABASE_URL;
const NOW = new Date();

// What each load may ask the database, in queries.
const BUDGET = { dock: 58, chat: 82, homeTop: 142 } as const;

describe.runIf(url)(
  "what the dock, the chat and Home ask the database",
  { timeout: 240_000 },
  () => {
    let client: PrismaClient;
    let userId: string;
    let queries = 0;
    // Every statement the database ran for the person's rows, not the transaction's BEGIN and COMMIT
    // or the switch to the person that each query carries.
    const isQuery = (sql: string) =>
      /^\s*(SELECT|INSERT|UPDATE|DELETE|WITH)\b/i.test(sql) && !sql.includes("set_config(");

    beforeAll(async () => {
      stubTestKeys();
      vi.stubEnv("DEMO_ADVICE", "1");
      client = new PrismaClient({
        adapter: new PrismaPg({ connectionString: url }),
        log: [{ emit: "event", level: "query" }],
      });
      (client as unknown as { $on: (e: "query", f: (q: { query: string }) => void) => void }).$on(
        "query",
        (event) => {
          if (isQuery(event.query)) queries += 1;
        },
      );
      userId = (
        await client.user.create({
          data: { email: `dock-queries-${crypto.randomUUID()}@example.com` },
        })
      ).id;
      const { itemId } = await linkDemoBank(userId, { client, now: NOW });
      await syncItem(itemId, { client, api: plaid, now: NOW, progressive: true });
      // What the first scan leaves: Jane's cards and suggestions.
      await runJaneAgent(userId, { client, now: NOW, trigger: "sync" });
      // A dock like the founder's: twelve cards waiting, two of them about a deadline Jane found, which
      // is what makes every dock load check the deadlines (the costly part of it).
      const upcoming = await loadComingUp(userId, { client, now: NOW, days: 0 });
      const deadlineKeys = upcoming.deadlines.slice(0, 2).map((d) => d.key);
      expect(deadlineKeys.length).toBe(2);
      await client.janeMessage.createMany({
        data: Array.from({ length: 12 }, (_, i) => ({
          userId,
          kind: i < 2 ? "heads_up" : "decision",
          body: `Card number ${i}\nMore about it.`,
          dedupeKey: `dock-queries:${i}`,
          refs: i < 2 ? { deadlineKey: deadlineKeys[i] } : {},
          actions: [{ id: "alert.got_it", label: "Got it", kind: "primary" }],
          createdAt: new Date(NOW.getTime() - i * 60_000),
        })),
      });
    }, 240_000);
    afterAll(async () => {
      // Only when the person was made: an undefined id would match every user.
      if (userId) await client.user.deleteMany({ where: { id: userId } });
      await client.$disconnect();
      vi.unstubAllEnvs();
    });

    const count = async <T>(load: () => Promise<T>) => {
      // A first load fills what a person's first look saves (the snapshot, their numbers).
      await load();
      queries = 0;
      const result = await load();
      return { used: queries, result };
    };

    // The route behind the dock (src/app/api/chat/cards/route.ts) loads the stack inside a read cache.
    it("loads the dock's cards inside the budget", async () => {
      const { used, result } = await count(() =>
        withRequestMemo(() => loadPopupStack(userId, { client, now: NOW })),
      );
      console.info(`dock: ${used} queries, ${result.length} cards`);
      expect(result.length).toBeGreaterThan(5);
      expect(used).toBeGreaterThan(0);
      expect(used).toBeLessThanOrEqual(BUDGET.dock);
    });

    // The side chat's page loads these four together (src/app/chat/page.tsx).
    it("opens the chat inside the budget", async () => {
      const { used } = await count(() =>
        withRequestMemo(() =>
          Promise.all([
            openChat(userId, { client: client, now: NOW, pages: 1 }),
            pinnedMessages(userId, { client: client }),
            loadPopupStack(userId, { client: client, now: NOW }),
            practiceCards(userId, { client: client, now: NOW }),
          ]),
        ),
      );
      console.info(`chat: ${used} queries`);
      expect(used).toBeGreaterThan(0);
      expect(used).toBeLessThanOrEqual(BUDGET.chat);
    });

    it("loads Home's top inside the budget", async () => {
      const { used } = await count(() =>
        withRequestMemo(() => loadHubTop(userId, { client: client, now: NOW })),
      );
      console.info(`home top: ${used} queries`);
      expect(used).toBeGreaterThan(0);
      expect(used).toBeLessThanOrEqual(BUDGET.homeTop);
    });
  },
);
