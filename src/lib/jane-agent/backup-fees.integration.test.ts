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

// The backup chat's fee answers on the walks' own upload cells (phone passes 5 to 7): "why did I
// get charged $34?" (S5, an insufficient funds fee for a $16.40 Safeway item), "why do I pay $12
// every month?" and "can I get my bank fee waived?" (S2, Bank of America's monthly maintenance fee
// with about $2,900 of pay a month) all said "I can't answer that one yet".
const url = process.env.TEST_DATABASE_URL;
const NOW = new Date("2026-11-20T19:00:00Z");
const CELLS = "src/lib/jane-agent/checks/__fixtures__/cells";

describe.runIf(url)("the backup chat on fees, on the walk's cells", { timeout: 300_000 }, () => {
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

  it("says what the $34 was (upload S5)", async () => {
    expect(await ask("upload-s5-phone", "Why did I get charged $34?")).toMatch(
      /^That's an insufficient funds fee on .+, Nov 2, for a \$16\.40 item\./,
    );
  });

  it("says what the $12 every month is, with the waiver card's reason (upload S2)", async () => {
    const body = await ask("upload-s2-phone", "Why do I pay $12 every month?");
    expect(body).toMatch(/^That's a monthly maintenance fee on .+\. It's been charged 3 times/);
    expect(body).toMatch(/Bank of America/);
  });

  it("answers whether the fee can be waived (upload S2)", async () => {
    const body = await ask("upload-s2-phone", "Can I get my bank fee waived?");
    expect(body).not.toMatch(/can't answer/);
    expect(body).toMatch(/\$12\.00 monthly fee/);
  });

  it("adds up the fees paid (upload S2)", async () => {
    expect(await ask("upload-s2-phone", "What fees have I paid?")).toMatch(
      /^You paid \$36\.00 in 3 fees in .+: 3 monthly maintenance fees \(\$36\.00\)/,
    );
  });
});
