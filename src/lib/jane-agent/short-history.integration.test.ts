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

import { madeUpChaseCsv } from "@/lib/__fixtures__/made-up-statement";
import { scopedFor } from "@/lib/db-scoped";
import { finishImport } from "@/lib/import/background";
import { saveUpload } from "@/lib/import/upload";
import { startStatementPerson } from "@/lib/statement-trial";
import { QUESTIONS } from "./checks/bank";
import { newPlayed, playbackClaude } from "./checks/real-path";
import { resetClaudeHealth } from "./claude";
import { runChatTool } from "./claude-tools";
import { sendToJane } from "./typing";

// A person with two months on file. Months before that aren't months of $0, a typical month isn't
// the two spread over a year, and a year with no income isn't a year with no tax. Past every
// other test file's clock: making a sample person clears trial people across the shared database.
const NOW = new Date("2031-03-20T19:00:00Z");
const url = process.env.TEST_DATABASE_URL;

const lastTwoMonths = () => {
  const [head, ...rows] = madeUpChaseCsv("ZZSHORT", NOW).trim().split("\n");
  const kept = rows.filter((r) => /^\w+,0[23]\/\d\d\/2031,/.test(r));
  return [head, ...kept, ""].join("\n");
};

describe.runIf(url)("a person with two months on file", { timeout: 180_000 }, () => {
  let client: PrismaClient;
  let id = "";
  const tool = async (name: string, input: unknown = {}) =>
    JSON.parse((await runChatTool(id, name, input, { client, now: NOW })).content);

  beforeAll(async () => {
    vi.stubEnv("TOKEN_ENCRYPTION_KEY", randomBytes(32).toString("base64"));
    vi.stubEnv("TRY_STATEMENT", "1");
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
    jobsDb.client = client;
    ({ userId: id } = await startStatementPerson({ client, now: NOW }));
    const form = new FormData();
    form.set("accountId", "new");
    form.set("new.name", "Made-up checking");
    form.set("new.kind", "checking");
    form.append("files", new File([lastTwoMonths()], "s.csv", { type: "text/csv" }));
    const saved = await saveUpload(scopedFor(id, client), form, { client });
    if (!saved.ok) throw new Error(saved.error);
    await finishImport(id, saved.runId, { client, now: NOW });
  });
  afterAll(async () => {
    await client.user.deleteMany({ where: { id } });
    await client.$disconnect();
    vi.unstubAllEnvs();
  });

  it("shows only the months it has seen", async () => {
    const { months, historyStarts } = await tool("monthly_totals");
    expect(months.map((m: { month: string }) => m.month)).toEqual(["2031-02", "2031-03"]);
    expect(historyStarts).toMatch(/^2031-02/);
  });

  it("doesn't spread a typical month over the empty ones", async () => {
    const { typicalMonthSpending } = await tool("monthly_totals");
    const { spending } = await tool("spending_by_category", { month: "2031-02" });
    expect(typicalMonthSpending).toBe(spending);
  });

  it("doesn't call a month before the file $0", async () => {
    const before = await tool("spending_by_category", { month: "2030-10" });
    expect(before.spending).toBeUndefined();
    expect(before.note).toContain("start 2031-02");
  });

  it("says the same when Claude can't answer", async () => {
    const text = "what did i spend in october";
    const q = { ...QUESTIONS[0], id: text, text, tool: undefined, needs: "claude", expect: {} };
    vi.stubEnv("ANTHROPIC_API_KEY", "played-back");
    resetClaudeHealth();
    const { reply } = await sendToJane(id, text, {
      client,
      now: NOW,
      claude: playbackClaude(q as (typeof QUESTIONS)[number], newPlayed(), "refused_always"),
      primerMs: 60_000,
    });
    expect(reply.body).toBe("I can't see October 2030: what I have starts in February 2031.");
  });

  it("doesn't call no debt seen owing $0", async () => {
    const { owes, debtsSeen } = await tool("net_worth");
    expect(owes).toBeNull();
    expect(debtsSeen).toBe(false);
  });

  it("doesn't call a year with no income a year with no tax", async () => {
    // In March the year asked about is last year's, and nothing on file is from then.
    for (const name of ["tax_estimate", "tax_years"]) {
      const out = await tool(name);
      expect(out.incomeSeen, name).toBe(false);
      expect(JSON.stringify(out), name).not.toContain("$0.00");
    }
  });
});
