import { randomBytes } from "node:crypto";
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

import { checkGuardrails, dollarFigures } from "@/lib/guardrails";
import { createCellPerson } from "./checks/cell";
import { deleteCheckPerson } from "./checks/person";
import { sendToJane } from "./typing";

// The backup chat (what answers when Claude can't), with Claude off, on the five questions it
// missed in every desktop sweep from 11 to 18 (mvp-ready.md, manager 11-23). Each now reaches the
// person's data, and so do its sibling wordings; one wording per miss still doesn't, as noted. Every
// answer passes the guardrails as a fixed answer does (its own figures, the standard profile).
const url = process.env.TEST_DATABASE_URL;
const NOW = new Date("2026-11-20T18:00:00Z");
const CELLS = "src/lib/jane-agent/checks/__fixtures__/cells";

type Asked = { body: string; source: string };

describe.runIf(url)("the backup chat's five misses", { timeout: 600_000 }, () => {
  let client: PrismaClient;
  const people: string[] = [];
  let minute = 0;

  beforeAll(() => {
    vi.stubEnv("TOKEN_ENCRYPTION_KEY", randomBytes(32).toString("base64"));
    // Claude off: the backup answers.
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
  const ask = async (id: string, question: string): Promise<Asked> => {
    minute += 1;
    const { reply, source } = await sendToJane(id, question, {
      client,
      now: new Date(NOW.getTime() + minute * 60_000),
    });
    return { body: reply.body, source };
  };
  const clean = (a: Asked) => {
    expect(a.source).toBe("rules");
    const guard = checkGuardrails(
      a.body,
      dollarFigures(a.body).map((f) => f.cents),
      undefined,
      "standard",
    );
    expect(guard.ok ? [] : guard.issues, a.body).toEqual([]);
  };

  it("1. a car loan the bank reports: when its payment is due, from the payments", async () => {
    // Plaid + loans (desktop sweeps 7 to 18): the bank reports a $12,880.00 car loan with no
    // payment of its own; checking pays Toyota Financial $345.12 on the 9th.
    const user = await client.user.create({
      data: { email: `backup-car-${crypto.randomUUID()}@example.com` },
    });
    people.push(user.id);
    const checking = await client.account.create({
      data: {
        userId: user.id,
        source: "plaid",
        name: "Plaid checking",
        type: "depository",
        subtype: "checking",
        currentBalanceCents: 164_025,
      },
    });
    await client.account.create({
      data: {
        userId: user.id,
        source: "plaid",
        name: "Plaid auto loan",
        type: "loan",
        subtype: "auto",
        currentBalanceCents: 1_288_000,
      },
    });
    for (const month of ["08", "09", "10", "11"]) {
      await client.transaction.create({
        data: {
          userId: user.id,
          accountId: checking.id,
          source: "plaid",
          date: new Date(`2026-${month}-09T00:00:00Z`),
          amountCents: 34_512,
          description: "TOYOTA FINANCIAL SVCS PAYMENT PPD ID: 9000123456",
          merchantName: "Toyota Financial",
          pfcPrimary: "LOAN_PAYMENTS",
          pfcDetailed: "LOAN_PAYMENTS_CAR_PAYMENT",
        },
      });
    }
    for (const q of [
      "When is my car payment due?",
      "How much is my car payment?",
      "When do I pay my car loan?",
      "How much do I pay for my car each month?",
    ]) {
      const a = await ask(user.id, q);
      expect(a.body, q).toContain("$345.12 a month");
      expect(a.body, q).toContain("Dec 9");
      clean(a);
    }
  });

  it("2. upload S7: whether the bank fee can be waived, by the waiver card's rule", async () => {
    const id = await cell("upload-s7-desktop");
    for (const q of [
      "Can my bank fee be waived?",
      "Can I avoid the Bank of America fee?",
      "Is there a way to stop paying the monthly fee?",
      "How do I get my monthly fee waived?",
    ]) {
      const a = await ask(id, q);
      expect(a.body, q).toContain("$12.00 monthly fee");
      expect(a.body, q).toContain("according to Bank of America's own page");
      clean(a);
    }
    // An investment fund's fees aren't the bank's: their own answer.
    expect((await ask(id, "Can I avoid fund fees?")).body).not.toContain("monthly fee");
  });

  it("3. upload S4: the investment gain, from the positions file's cost basis", async () => {
    const id = await cell("upload-s4-desktop");
    for (const q of [
      "How much have I gained?",
      "What is my gain on Fidelity?",
      "Am I up or down on my investments?",
      "How much have I made on my investments?",
    ]) {
      const a = await ask(id, q);
      // The file's Total Gain/Loss: FXAIX +$896.72, FFNOX +$178.52, on $5,400.00 of cost basis.
      expect(a.body, q).toContain("up $1,075.24");
      expect(a.body, q).toContain("$5,400.00 paid");
      clean(a);
    }
    // Still not: a gain that isn't money.
    expect((await ask(id, "How much weight have I lost?")).source).toBe("fallback");
  });

  it("4. upload S5: a charge not seen this month, from all the data", async () => {
    const id = await cell("upload-s5-desktop");
    for (const q of ["How much is ChatGPT?", "How much do I pay for ChatGPT?"]) {
      const a = await ask(id, q);
      expect(a.body, q).toMatch(/^Chatgpt was \$20\.00, last on Oct \d+\. That's the one charge/);
      clean(a);
    }
    // One charged this month still answers with this month.
    expect((await ask(id, "How much is Starbucks?")).body).toContain("November 2026 so far");
    // Still not: asked when, not how much.
    expect((await ask(id, "When did ChatGPT charge me?")).source).toBe("fallback");
  });

  it("5. upload S1: what mom sends, from the lines that name her", async () => {
    const id = await cell("upload-s1-desktop");
    for (const q of [
      "How much does my mom send me?",
      "How much money do I get from my mom?",
      "What does my mom send me?",
    ]) {
      const a = await ask(id, q);
      expect(a.body, q).toBe(
        "The lines that say MOM came to $200.00 by Venmo on Aug 20, Sep 20 and Oct 20 ($600.00 in all).",
      );
      clean(a);
    }
    // Asked about someone the lines don't name: all of it, and that it can't be told apart.
    expect((await ask(id, "How much does my dad send me?")).body).toContain(
      "can't tell which is from your dad",
    );
    // From an app: everyone's, no one named.
    expect((await ask(id, "How much comes in from Venmo?")).body).toBe(
      "People sent you $200.00 by Venmo on Aug 20, Sep 20 and Oct 20 ($600.00 in all).",
    );
    // Still not: pay from a job isn't money people send.
    expect((await ask(id, "How much money do I get from my job?")).source).toBe("fallback");
  });
});
