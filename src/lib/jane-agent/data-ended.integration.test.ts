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
import { askClaudeInChat, resetClaudeHealth } from "./claude";
import { runChatTool } from "./claude-tools";
import { sendToJane } from "./typing";

// Someone uploaded a statement and came back sixty days later, with nothing new. Past every other
// test file's clock: making a sample person clears trial people across the shared database.
const UPLOADED = new Date("2031-03-20T19:00:00Z");
const NOW = new Date(UPLOADED.getTime() + 60 * 86_400_000);
const url = process.env.TEST_DATABASE_URL;

describe.runIf(url)("sixty days after the only statement", { timeout: 180_000 }, () => {
  let client: PrismaClient;
  let id = "";
  const tool = async (name: string, input: unknown = {}) =>
    JSON.parse((await runChatTool(id, name, input, { client, now: NOW })).content);
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
    ({ userId: id } = await startStatementPerson({ client, now: UPLOADED }));
    const form = new FormData();
    form.set("accountId", "new");
    form.set("new.name", "Made-up checking");
    form.set("new.kind", "checking");
    form.append(
      "files",
      new File([madeUpChaseCsv("ZZENDED", UPLOADED)], "s.csv", { type: "text/csv" }),
    );
    const saved = await saveUpload(scopedFor(id, client), form, { client });
    if (!saved.ok) throw new Error(saved.error);
    await finishImport(id, saved.runId, { client, now: UPLOADED });
  });
  afterAll(async () => {
    await client.user.deleteMany({ where: { id } });
    await client.$disconnect();
    vi.unstubAllEnvs();
  });

  it("doesn't call the months since $0", async () => {
    expect(await ask("what did i spend this month")).toBe(
      "I can't see May 2031: what I have ends on Mar 20.",
    );
    const { months, historyEnds } = await tool("monthly_totals");
    expect(months.at(-1).month).toBe("2031-03");
    expect(historyEnds).toBe("2031-03-20");
    const april = await tool("spending_by_category", { month: "2031-04" });
    expect(april.spending).toBeUndefined();
    expect(april.note).toContain("end 2031-03-20");
  });

  it("doesn't forecast from a balance that old", async () => {
    expect(await ask("will i overdraft this month")).toMatch(
      /^.*I can't say: what I have for your checking ends on Mar 20/,
    );
    expect((await tool("balance_forecast")).note).toContain("too old to forecast");
    expect((await tool("safe_to_spend")).note).not.toContain("linked");
  });

  it("says its numbers are old ahead of what it reads off them", async () => {
    expect(await ask("whats my net worth")).toMatch(
      /^What I have ends on Mar 20, so this may be out of date\. Your net worth is/,
    );
  });

  it("tells Claude, so a date from it passes the figure check", async () => {
    const stream = vi.fn();
    const claude = () =>
      ({
        messages: {
          stream: (params: unknown) => {
            stream(params);
            const s = {
              on: () => s,
              finalMessage: async () => ({
                stop_reason: "end_turn",
                content: [
                  { type: "text", text: "What I have ends on Mar 20, so I can't see May." },
                ],
                usage: { input_tokens: 10, output_tokens: 10 },
              }),
            };
            return s;
          },
        },
      }) as never;
    resetClaudeHealth();
    const answer = await askClaudeInChat(id, [], "what did i spend this month", {
      client,
      now: NOW,
      claude,
    });
    expect(answer.reply?.body).toBe("What I have ends on Mar 20, so I can't see May.");
    expect(JSON.stringify(stream.mock.calls[0][0])).toContain(
      "Their transactions end on 2031-03-20",
    );
  });
});
