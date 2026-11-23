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

// The backup chat's misses still open after #2228, from walk-chat-questions.md, replayed with
// Claude off on the walked files and fixed by cause (manager 11-23). Each with its sibling
// wordings; one that still doesn't answer is noted. Every answer passes the guardrails.
const url = process.env.TEST_DATABASE_URL;
const NOW = new Date("2026-11-20T18:00:00Z");
const CELLS = "src/lib/jane-agent/checks/__fixtures__/cells";

describe.runIf(url)("the backup chat's recorded misses", { timeout: 900_000 }, () => {
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
    const { reply, source, intent } = await sendToJane(id, question, {
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
    return { body: reply.body, source, intent };
  };

  it("why a fee is charged: the fee explained, not the card's yearly figure (upload S2)", async () => {
    const id = await cell("upload-s2-phone-7");
    for (const q of [
      "Why am I paying fees at Bank of America?",
      "Why do I have a fee every month?",
      "Why was I charged a maintenance fee?",
      "What is this $12 fee?",
    ]) {
      const { body } = await ask(id, q);
      expect(body, q).toMatch(
        /^That's a monthly maintenance fee on Bank of America checking, Oct 28/,
      );
      expect(body, q).toContain("according to Bank of America's own page");
      expect(body, q).not.toMatch(/could save/i);
    }
  });

  it("a charge asked by its amount and name (upload S3)", async () => {
    const id = await cell("upload-s3-phone-6");
    expect((await ask(id, "What was the $14 Nelnet charge?")).body).toBe(
      "That's Nelnet Student Loan Late Fee, $14.00 on Sep 4, from Chase checking.",
    );
    expect((await ask(id, "What is the $338.12 charge?")).body).toMatch(
      /^That's Toyota Motor Credit, \$338\.12 on Nov 7/,
    );
    expect((await ask(id, "What was the $142.60 charge?")).body).toMatch(/^That's Geico Auto/);
    // By name alone, still its latest charge against its usual.
    expect((await ask(id, "What was the Nelnet charge?")).intent).toBe("charge_story");
  });

  it("what's due on the loans each month: each loan's next payment (upload S3)", async () => {
    const id = await cell("upload-s3-phone-6");
    for (const q of [
      "How much is due on my loans each month?",
      "What do I pay on my loans each month?",
      "What are my loan payments?",
    ]) {
      const { body, intent } = await ask(id, q);
      expect(intent, q).toBe("debt_due");
      expect(body, q).toContain("Dec 3: Nelnet Student Loan, $214.37");
      expect(body, q).toContain("Dec 7: Toyota Motor Credit car loan, $338.12");
    }
  });

  it("a bill that moves with use: its range and usual amount (upload S1)", async () => {
    const id = await cell("upload-s1-phone-6");
    for (const q of [
      "How much is my electric bill?",
      "How much is Xcel Energy?",
      "How much is my Xcel bill?",
    ]) {
      expect((await ask(id, q)).body, q).toBe(
        "Xcel Energy varies: $38.72 to $57.49, about $47.60 a month. The last was $57.49. The next charge is Dec 4 (in 14 days).",
      );
    }
  });

  it("when a price went up: from its charges, with the day (upload S1)", async () => {
    const id = await cell("upload-s1-phone-6");
    for (const q of ["When did Hulu go up?", "How much did Hulu go up?", "Has Hulu gone up?"]) {
      expect((await ask(id, q)).body, q).toBe(
        "Hulu went up on Nov 12, 2026, from $9.99 to $11.99 a month: $24.00 a year more.",
      );
    }
  });

  it("why overdraft fees are charged is the fee's own answer now (backup-still-nots)", async () => {
    const id = await cell("upload-s6-desktop");
    expect((await ask(id, "Why am I paying overdraft fees?")).intent).toBe("fee_why");
  });
});
