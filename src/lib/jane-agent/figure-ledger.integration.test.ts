import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { PersonId } from "@/config/people";
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

// The ledger scored both ways on what the tools really return: a true statement passes and the
// same number about the wrong thing fails. And on what's been written in earnest: Jane's rule
// replies, and answers Claude really wrote, have to pass, or it would block good answers.

const url = process.env.TEST_DATABASE_URL;
const NOW = new Date();
// When the recorded answers were written: they're checked against that day's numbers.
const RECORDED_ON = new Date("2026-10-21T15:00:00Z");
// Answers the check has been read against by hand, and what's left over is on the list below.
const RECORDED_LIVES = (process.env.FIGURE_LEDGER_LIVES ?? "renter,owner").split(",");
const EVERY_NTH_MESSAGE = 15;

type Recorded = { id: string; text: string; answer: string };
const recorded = JSON.parse(
  readFileSync("src/lib/jane-agent/checks/recorded-answers.json", "utf8"),
) as Recorded[];

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

describe.runIf(url)("the figure ledger on real tool results", { timeout: 900_000 }, () => {
  let client: PrismaClient;
  let userId = "";
  let ledger: FigureLedger;
  const tool = async (name: string, input: unknown = {}) =>
    JSON.parse((await runChatTool(userId, name, input, { client, now: NOW })).content);
  const kinds = (text: string, on = ledger, now = NOW) => on.problems(text, now).map((p) => p.kind);

  const ledgerFor = async (id: string, now: Date) => {
    const built = new FigureLedger();
    built.addLines((await chatPrimer(id, { client, now })).text);
    for (const each of CHAT_TOOLS) {
      const output = await runChatTool(id, each.name, inputFor(each), { client, now }).catch(
        () => null,
      );
      if (output) built.addToolResult(output.content);
    }
    return built;
  };

  beforeAll(async () => {
    vi.stubEnv("TOKEN_ENCRYPTION_KEY", randomBytes(32).toString("base64"));
    vi.spyOn(console, "info").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
    userId = await createCheckPerson({ client, now: NOW });
    ledger = await ledgerFor(userId, NOW);
  });
  afterAll(async () => {
    await deleteCheckPerson(userId, { client });
    await client.$disconnect();
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("every subscription's price is its own, and no other's", async () => {
    const { charges } = (await tool("subscriptions")) as {
      charges: { merchant: string; billed: string; lastCharge: string; aYear: string }[];
    };
    expect(charges.length).toBeGreaterThan(5);
    let swapped = 0;
    charges.forEach((charge, i) => {
      expect(kinds(`${charge.merchant} is ${charge.aYear} a year.`), charge.merchant).toEqual([]);
      if (charge.billed !== "monthly") return;
      expect(kinds(`${charge.merchant} is ${charge.lastCharge} a month.`), charge.merchant).toEqual(
        [],
      );
      expect(kinds(`${charge.merchant} is ${charge.lastCharge} a year.`), charge.merchant).toEqual([
        "wrong_cadence",
      ]);
      const other = charges[(i + 1) % charges.length];
      // Two that really cost the same aren't a mistake.
      const same = charges.some(
        (c) => c.lastCharge === charge.lastCharge && c.merchant === other.merchant,
      );
      if (same) return;
      swapped += 1;
      expect(kinds(`${other.merchant} is ${charge.lastCharge} a month.`), other.merchant).toEqual([
        "wrong_name",
      ]);
    });
    expect(swapped).toBeGreaterThan(5);
  });

  it("every month's total is that month's, and no other's", async () => {
    const { months } = (await tool("monthly_totals")) as {
      months: { month: string; spending: string }[];
    };
    const spent = months.filter((m) => m.spending !== "$0.00");
    expect(spent.length).toBeGreaterThan(2);
    const named = (month: string) =>
      new Date(`${month}-15T00:00:00Z`).toLocaleString("en-US", {
        month: "long",
        year: "numeric",
        timeZone: "UTC",
      });
    spent.forEach((row, i) => {
      expect(kinds(`In ${named(row.month)} you spent ${row.spending}.`), row.month).toEqual([]);
      const other = spent[(i + 1) % spent.length];
      if (other.spending === row.spending) return;
      expect(kinds(`In ${named(other.month)} you spent ${row.spending}.`), row.month).toEqual([
        "wrong_period",
      ]);
    });
  });

  it("every debt's balance and rate are its own, and no other's", async () => {
    const { debts } = (await tool("debts")) as {
      debts: { name: string; balance: string; rate: string | null }[];
    };
    const priced = debts.filter((d) => d.balance && d.rate && d.rate !== "0.00%");
    expect(priced.length).toBeGreaterThan(2);
    const notCaught: string[] = [];
    priced.forEach((debt, i) => {
      expect(kinds(`${debt.name} has ${debt.balance} left at ${debt.rate}.`), debt.name).toEqual(
        [],
      );
      const other = priced[(i + 1) % priced.length];
      const balance = `${other.name} has ${debt.balance} left.`;
      const rate = `${other.name} is at ${debt.rate}.`;
      expect(kinds(balance), balance).toEqual(["wrong_name"]);
      if (kinds(rate).length === 0) notCaught.push(rate);
    });
    // Where a tool's own sentence names both debts, it can't say whose rate it gives. Only then.
    expect(notCaught.length, notCaught.join(" ")).toBeLessThanOrEqual(1);
  });

  it("what's coming up is due when it's due", async () => {
    const { items } = (await tool("coming_up")) as { items: { date: string; what: string }[] };
    expect(items.length).toBeGreaterThan(2);
    for (const item of items) {
      const [, month, day] = item.date.split("-").map(Number);
      const when = `${new Date(Date.UTC(2026, month - 1, 1)).toLocaleString("en-US", { month: "short", timeZone: "UTC" })} ${day}`;
      expect(kinds(`${item.what} is due ${when}.`), item.what).toEqual([]);
    }
    expect(kinds("Something is due Feb 30.")).toEqual(["unsupported_date"]);
  });

  it("passes Jane's rule replies, which come from the same numbers", async () => {
    type Scenario = { messages: string[] };
    const seen = new Set<string>();
    const messages = [
      "docs/chat-scenarios.json",
      "docs/chat-scenarios-2.json",
      "docs/chat-scenarios-3.json",
    ]
      .flatMap((file) => JSON.parse(readFileSync(file, "utf8")) as Scenario[])
      .flatMap((s) => s.messages)
      .filter((text) => (seen.has(text) ? false : Boolean(seen.add(text))))
      .filter((_, i) => i % EVERY_NTH_MESSAGE === 0);
    expect(messages.length).toBeGreaterThan(50);
    process.env.ANTHROPIC_API_KEY = "played-back";
    process.env.CHAT_MONTHLY_CAP_CENTS = "1000000000";
    const wrong: string[] = [];
    for (const text of messages) {
      resetClaudeHealth();
      await client.rateLimit.deleteMany({ where: { key: { in: [`chat:${userId}`] } } });
      const question = {
        id: text,
        text,
        needs: "claude",
        expect: {},
      } as (typeof QUESTIONS)[number];
      const { reply } = await sendToJane(userId, text, {
        client,
        now: NOW,
        claude: playbackClaude(question, newPlayed(), "refused_always"),
        primerMs: 60_000,
      });
      ledger.addText(text);
      for (const problem of ledger.problems(reply.body, NOW)) {
        wrong.push(`${text}: ${problem.kind}: ${problem.why}`);
      }
    }
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.CHAT_MONTHLY_CAP_CENTS;
    expect(wrong).toEqual([]);
  });

  it("passes answers Claude really wrote, against that day's numbers", async () => {
    const wrong: string[] = [];
    for (const life of RECORDED_LIVES) {
      const answers = recorded.filter((r) => r.id.endsWith(`.${life}`));
      expect(answers.length).toBeGreaterThan(5);
      const id = await createCheckPerson({ client, now: RECORDED_ON, person: life as PersonId });
      const then = await ledgerFor(id, RECORDED_ON);
      for (const r of answers) {
        then.addText(r.text);
        for (const p of then.problems(r.answer, RECORDED_ON)) {
          wrong.push(`${r.id}: ${p.kind}: ${p.why}`);
        }
      }
      await deleteCheckPerson(id, { client });
    }
    expect(wrong).toEqual([]);
  });
});
