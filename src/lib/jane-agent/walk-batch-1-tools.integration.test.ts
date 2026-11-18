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
import { createCellPerson } from "./checks/cell";
import { deleteCheckPerson } from "./checks/person";
import { runChatTool } from "./claude-tools";

// Walk batch 1 (11-18): the phone debugger's upload cells asked of Claude live, through chat-eval.
// Two tools gave Claude too little: on statements ending Sep 28, "subscriptions" returned nothing
// ("I don't see any subscriptions"), and on a month of pay every two weeks the forecast listed no
// deposit before its low point, the day before payday ("I can't tell when your next paycheck
// lands"). The cells are the walk's own files (walk-chat-data in the manager's notes).
const url = process.env.TEST_DATABASE_URL;
const NOW = new Date("2026-11-18T19:00:00Z");
const CELLS = "src/lib/jane-agent/checks/__fixtures__/cells";

describe.runIf(url)("the tools on the walk's upload cells", { timeout: 300_000 }, () => {
  let client: PrismaClient;
  const made: string[] = [];
  const person = async (cell: string) => {
    const id = await createCellPerson(`${CELLS}/${cell}`, { client, now: NOW });
    made.push(id);
    return id;
  };
  const tool = async (id: string, name: string) =>
    JSON.parse((await runChatTool(id, name, {}, { client, now: NOW })).content) as Record<
      string,
      unknown
    >;

  beforeAll(() => {
    stubTestKeys();
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url! }) });
  });

  afterAll(async () => {
    for (const id of made) await deleteCheckPerson(id, { client });
    await client.$disconnect();
  });

  it("gives old statements' subscriptions as of their last day, saying when that was", async () => {
    const out = await tool(await person("upload-s7-phone"), "subscriptions");
    expect(out).toMatchObject({ charges: [], statementsEnd: "2026-09-28" });
    expect(out.inTheirStatements).toEqual(
      expect.arrayContaining([expect.objectContaining({ lastCharge: "$15.49" })]),
    );
    expect(JSON.stringify(out.inTheirStatements)).toMatch(/netflix/i);
  });

  it("names the next deposit in the forecast, past its low point", async () => {
    const out = await tool(await person("upload-s5-phone"), "balance_forecast");
    const [account] = out.accounts as {
      nextDeposit: { from: string; on: string; amount: string };
    }[];
    expect(account.nextDeposit).toMatchObject({ amount: "$620.00" });
    expect(account.nextDeposit.from).toMatch(/univ of calif/i);
    expect(["2026-11-25", "2026-11-26"]).toContain(account.nextDeposit.on);
  });
});
