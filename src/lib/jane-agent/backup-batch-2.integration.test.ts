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

// The backup chat's second batch on the walks' own upload cells (phone passes 5 to 7): "how much do I
// put into savings each month?" (S6, $200 a month to Ally), "how much do I send on Venmo?" (S5) and
// "how much card interest have I paid this year?" (S2's Chase card) were unanswered or answered for
// another period.
const url = process.env.TEST_DATABASE_URL;
const NOW = new Date("2026-11-20T19:00:00Z");
const CELLS = "src/lib/jane-agent/checks/__fixtures__/cells";

describe.runIf(url)(
  "the backup chat's second batch, on the walk's cells",
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

    it("gives a month into savings (upload S6)", async () => {
      expect(await ask("upload-s6-phone", "How much do I put into savings each month?")).toMatch(
        /^You move about \$200\.00 a month into savings/,
      );
    });

    it("gives what went out by Venmo (upload S5)", async () => {
      expect(await ask("upload-s5-phone", "How much do I send on Venmo?")).toMatch(
        /^You've sent \$25\.00 by Venmo since Oct 23 \(once\)\.$/,
      );
    });

    it("gives this year's card interest first (upload S2)", async () => {
      expect(await ask("upload-s2-phone", "How much card interest have I paid this year?")).toMatch(
        /^You've paid \$84\.81 in card interest in 2026: 2 charges, Sep to Oct\./,
      );
    });
  },
);
