import { randomBytes } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));

import { QUESTIONS } from "./checks/bank";
import { createCheckPerson, deleteCheckPerson } from "./checks/person";
import { newPlayed, playbackClaude } from "./checks/real-path";
import { resetClaudeHealth } from "./claude";
import { CHAT_TOOLS, chatPrimer, runChatTool } from "./claude-tools";
import { FigureLedger } from "./figure-ledger";
import { sendToJane } from "./typing";

// Debugger 11-15: figure-ledger.integration.test.ts failed on every PR from the demo person's payday
// (Nov 15): after it, the balance forecast lists the next paycheck under Demo Checking, and the
// ledger gave its $2,450.00 to the account, so Jane's "about $2,450.00 from Acme Corp" read as the
// wrong name. The same person's payday answer passes the ledger the day before payday and on it.

const url = process.env.TEST_DATABASE_URL;
const DAYS = [new Date("2026-11-14T20:00:00Z"), new Date("2026-11-15T09:00:00Z")];
const ASKED = ["yoo whens payday", "should i pay myslef a salary"];

const inputFor = (tool: (typeof CHAT_TOOLS)[number]) => {
  const schema = tool.input_schema as {
    required?: string[];
    properties?: Record<string, { type?: string; enum?: unknown[] }>;
  };
  return Object.fromEntries(
    (schema.required ?? []).map((key) => {
      const property = schema.properties?.[key];
      if (property?.enum?.length) return [key, property.enum[0]];
      return [key, property?.type === "number" ? 1 : "groceries"];
    }),
  );
};

describe.runIf(url)("the payday answer against the figure ledger", { timeout: 600_000 }, () => {
  let client: PrismaClient;
  const people: string[] = [];

  beforeAll(() => {
    vi.stubEnv("TOKEN_ENCRYPTION_KEY", randomBytes(32).toString("base64"));
    vi.stubEnv("ANTHROPIC_API_KEY", "played-back");
    vi.stubEnv("CHAT_MONTHLY_CAP_CENTS", "1000000000");
    vi.spyOn(console, "info").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  });
  afterAll(async () => {
    for (const id of people) await deleteCheckPerson(id, { client });
    await client.$disconnect();
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  for (const now of DAYS) {
    it(`agrees with the tools on ${now.toISOString().slice(0, 10)}`, async () => {
      const id = await createCheckPerson({ client, now });
      people.push(id);
      const ledger = new FigureLedger();
      ledger.addLines((await chatPrimer(id, { client, now })).text);
      for (const tool of CHAT_TOOLS) {
        const output = await runChatTool(id, tool.name, inputFor(tool), { client, now }).catch(
          () => null,
        );
        if (output) ledger.addToolResult(output.content);
      }
      const wrong: string[] = [];
      for (const text of ASKED) {
        resetClaudeHealth();
        const question = {
          id: text,
          text,
          needs: "claude",
          expect: {},
        } as (typeof QUESTIONS)[number];
        const { reply } = await sendToJane(id, text, {
          client,
          now,
          claude: playbackClaude(question, newPlayed(), "refused_always"),
          primerMs: 60_000,
        });
        expect(reply.body).toMatch(/\$2,450\.00 from Acme Corp/);
        ledger.addText(text);
        for (const p of ledger.problems(reply.body, now))
          wrong.push(`${text}: ${p.kind}: ${p.why}`);
      }
      expect(wrong).toEqual([]);
    });
  }
});
