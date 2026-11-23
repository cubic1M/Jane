import { randomBytes } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.hoisted(() => {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? "";
});
vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/categorize/llm", () => ({ classifyMerchants: vi.fn(async () => new Map()) }));

import { checkGuardrails, dollarFigures } from "@/lib/guardrails";
import { createCellPerson } from "./checks/cell";
import { deleteCheckPerson } from "./checks/person";
import { sendToJane } from "./typing";

// The three questions #2230 left as still not answered (manager 11-23), with Claude off on the
// walked files: why overdraft fees are charged, what goes to a person by name, and when a service
// last charged. Every answer passes the guardrails.
const url = process.env.TEST_DATABASE_URL;
const NOW = new Date("2026-11-20T18:00:00Z");
const CELLS = "src/lib/jane-agent/checks/__fixtures__/cells";

describe.runIf(url)("the backup chat's three still-nots", { timeout: 600_000 }, () => {
  let client: PrismaClient;
  const people: string[] = [];
  let minute = 0;

  beforeAll(() => {
    vi.stubEnv("TOKEN_ENCRYPTION_KEY", randomBytes(32).toString("base64"));
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url! }) });
  });

  afterAll(async () => {
    for (const id of people) await deleteCheckPerson(id, { client }).catch(() => {});
    await client.$disconnect();
    vi.unstubAllEnvs();
  });

  const cell = async (name: string) => {
    const id = await createCellPerson(`${CELLS}/${name}`, { client, now: NOW });
    people.push(id);
    return id;
  };
  const ask = async (id: string, question: string) => {
    minute += 1;
    const { reply, intent } = await sendToJane(id, question, {
      client,
      now: new Date(NOW.getTime() + minute * 60_000),
    });
    const guard = checkGuardrails(
      reply.body,
      dollarFigures(reply.body).map((f) => f.cents),
      undefined,
      "standard",
    );
    expect(guard.ok ? [] : guard.issues, reply.body).toEqual([]);
    return { body: reply.body, intent };
  };

  it("why overdraft fees are charged: the latest overdraft fee explained (upload S6)", async () => {
    const id = await cell("upload-s6-desktop");
    const { body, intent } = await ask(id, "Why am I paying overdraft fees?");
    expect(intent).toBe("fee_why");
    expect(body).toMatch(/^That's an overdraft fee on /);
    // Whether checking will go below zero is still its own question.
    expect((await ask(id, "Am I going to overdraft?")).intent).toBe("debt_decision");
  });

  it("what goes to a person by name, and when a service last charged (upload S5)", async () => {
    const id = await cell("upload-s5-desktop");
    expect((await ask(id, "When did ChatGPT charge me?")).body).toMatch(
      /^Your latest Chatgpt charge was \$20\.00 on Oct 25/,
    );
    expect((await ask(id, "When was I last charged by ChatGPT?")).intent).toBe("charge_story");
    const rent = await ask(id, "How much do I send Alex K?");
    expect(rent.intent).toBe("cost");
    expect(rent.body).toContain("$850.00");
    // By app, still what went out on it.
    expect((await ask(id, "How much do I send on Venmo?")).intent).toBe("sent_by_app");
  });
});
