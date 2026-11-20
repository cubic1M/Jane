import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

// As the scenario run does: the app's own client points at the test database.
vi.hoisted(() => {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? "";
});
vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/categorize/llm", () => ({ classifyMerchants: vi.fn(async () => new Map()) }));

import { stubTestKeys } from "@/lib/__fixtures__/env";
import { answerByRules } from "./answer";
import { createCellPerson } from "./checks/cell";
import { deleteCheckPerson } from "./checks/person";
import { parseIntent } from "./intents";

// Two backup-chat answers that said too little, on the walks' own upload cells (phone passes 6 and
// 7): "how much is my internet bill?" on S7's statements ending Sep 28 left out the $55.00 Xfinity,
// and "what subscriptions do I have?" on S5's one month named none of the ones charged once.
const url = process.env.TEST_DATABASE_URL;
const NOW = new Date("2026-11-20T19:00:00Z");
const CELLS = "src/lib/jane-agent/checks/__fixtures__/cells";

describe.runIf(url)(
  "the backup chat's leftovers, on the walk's cells",
  { timeout: 300_000 },
  () => {
    let client: PrismaClient;
    const made: string[] = [];
    const ask = async (cell: string, question: string) => {
      const id = await createCellPerson(`${CELLS}/${cell}`, { client, now: NOW });
      made.push(id);
      return (await answerByRules(id, parseIntent(question, "2026-11-20"), { client, now: NOW }))
        ?.body;
    };

    beforeAll(() => {
      stubTestKeys();
      client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url! }) });
    });

    afterAll(async () => {
      for (const id of made) await deleteCheckPerson(id, { client });
      await client.$disconnect();
    });

    it("gives the internet bill the old statements show, as of their end (upload S7)", async () => {
      expect(await ask("upload-s7-phone", "How much is my internet bill?")).toMatch(
        /^In your statements, which end Sep 28, Xfinity was \$55\.00 a month \(last on Sep 20\)\. Whether it's the same now I can't tell from them\.$/,
      );
    });

    it("names what looks like a subscription on a month of data (upload S5)", async () => {
      const body = await ask("upload-s5-phone", "What subscriptions do I have?");
      expect(body).toMatch(/look like subscriptions, one charge each so far/);
      expect(body).toMatch(/Hulu \$9\.99/);
    });
  },
);
