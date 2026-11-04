import { randomBytes } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));
const jobsDb = vi.hoisted(() => ({ client: undefined as unknown }));
// CI has no default database, so an upload's job goes to this test's, as a real row.
vi.mock("@/lib/jobs", async (importOriginal) => {
  const jobs = await importOriginal<typeof import("@/lib/jobs")>();
  return {
    ...jobs,
    enqueueJob: (...[kind, payload, options]: Parameters<typeof jobs.enqueueJob>) =>
      jobs.enqueueJob(kind, payload, { client: jobsDb.client as never, ...options }),
  };
});

import { madeUpCardCsv } from "@/lib/__fixtures__/made-up-statement";
import { scopedFor } from "@/lib/db-scoped";
import { finishImport } from "@/lib/import/background";
import { saveUpload } from "@/lib/import/upload";
import { startStatementPerson } from "@/lib/statement-trial";
import { QUESTIONS } from "./checks/bank";
import { newPlayed, playbackClaude } from "./checks/real-path";
import { resetClaudeHealth } from "./claude";
import { runChatTool } from "./claude-tools";
import { parseIntent } from "./intents";
import { sendToJane } from "./typing";

// A card statement alone: no checking, no income and no balance. What isn't on file isn't $0, and
// nothing overdue isn't "you're OK". Past every other test file's clock: making a sample person
// clears trial people across the shared database.
const NOW = new Date("2031-03-20T19:00:00Z");
const url = process.env.TEST_DATABASE_URL;

describe.runIf(url)("a person with only a card statement", { timeout: 180_000 }, () => {
  let client: PrismaClient;
  let id = "";
  const tool = async (name: string) =>
    JSON.parse((await runChatTool(id, name, {}, { client, now: NOW })).content);
  const ask = async (text: string) => {
    const q = { ...QUESTIONS[0], id: text, text, tool: undefined, needs: "claude", expect: {} };
    resetClaudeHealth();
    const { reply } = await sendToJane(id, text, {
      client,
      now: NOW,
      claude: playbackClaude(q as (typeof QUESTIONS)[number], newPlayed(), "refused_always"),
      primerMs: 60_000,
    });
    return reply.body;
  };

  beforeAll(async () => {
    vi.stubEnv("TOKEN_ENCRYPTION_KEY", randomBytes(32).toString("base64"));
    vi.stubEnv("TRY_STATEMENT", "1");
    vi.stubEnv("ANTHROPIC_API_KEY", "played-back");
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
    jobsDb.client = client;
    ({ userId: id } = await startStatementPerson({ client, now: NOW }));
    const form = new FormData();
    form.set("accountId", "new");
    form.set("new.name", "Made-up card");
    form.set("new.kind", "credit_card");
    form.append("files", new File([madeUpCardCsv("ZZCARD", NOW)], "s.csv", { type: "text/csv" }));
    const saved = await saveUpload(scopedFor(id, client), form, { client });
    if (!saved.ok) throw new Error(saved.error);
    await finishImport(id, saved.runId, { client, now: NOW });
  });
  afterAll(async () => {
    await client.user.deleteMany({ where: { id } });
    await client.$disconnect();
    vi.unstubAllEnvs();
  });

  it("doesn't say they owe $0.00", async () => {
    expect(await ask("how much do i owe")).toMatch(
      /^I can't see what you owe on Made-up card yet\./,
    );
    const debts = await tool("debts");
    expect(debts.totalOwed).toBeNull();
    expect(debts.loansAndCardsOwed).toBeNull();
    expect(debts.balancesNotKnown).toEqual(["Made-up card"]);
  });

  it("doesn't work out a plan from nothing", async () => {
    const plan = await tool("payoff_plan");
    expect(plan.leftOut).toEqual([{ name: "Made-up card", reason: "no_balance" }]);
    expect(plan.payingMore).toBeUndefined();
    expect(JSON.stringify(plan)).not.toContain("$0.00");
  });

  it("doesn't say they're OK when it can't see their cash", async () => {
    expect(await ask("am i ok")).toMatch(/^I can't say yet: I can't see your cash right now\./);
    expect((await tool("whole_picture")).verdict).toBe("watch");
  });

  it("doesn't weigh a decision on no card debt", async () => {
    expect((await tool("decision")).cardDebt).toBe("not known: no balance on file");
  });

  it("offers nothing at 0% sure", async () => {
    expect(JSON.stringify(await tool("priorities"))).not.toContain("0% sure");
  });

  it("doesn't call a card statement no income", async () => {
    const { months } = await tool("monthly_totals");
    expect(months.every((m: { income: string | null }) => m.income === null)).toBe(true);
    expect((await tool("spending_by_category")).income).toBeNull();
  });

  it('reads "did i pay my card" as a question about what happened', () => {
    expect(parseIntent("did i pay my card this month", "2031-03-20").kind).not.toBe("bills_paid");
    expect(parseIntent("pay my bills on time", "2031-03-20").kind).toBe("bills_paid");
  });
});
