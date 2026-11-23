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
import { parseIntent } from "./intents";
import { sendToJane } from "./typing";

// After #2228 widened the fee-waiver route, questions of fact took it too and got the waiver rule
// (manager 11-23). "Did my fee get refunded?" and "which fees were removed?" are answered from the
// lines: what was given back, when, how much, and the fee it was for; "can it be waived?" keeps the
// rule. With Claude off.
const url = process.env.TEST_DATABASE_URL;
const NOW = new Date("2026-11-20T18:00:00Z");

describe("what the fee questions are read as", () => {
  it.each([
    ["Did my fee get refunded?", "fee_refunds"],
    ["Which fees were removed?", "fee_refunds"],
    ["Was my overdraft fee reversed?", "fee_refunds"],
    ["Have any of my fees been refunded?", "fee_refunds"],
    ["Can my bank fee be waived?", "fee_waiver"],
    ["How do I get my monthly fee waived?", "fee_waiver"],
  ])("%s", (question, kind) => {
    expect(parseIntent(question, "2026-11-20").kind).toBe(kind);
  });
});

describe.runIf(url)("whether a fee was given back, from the lines", { timeout: 300_000 }, () => {
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

  const ask = async (id: string, question: string) => {
    minute += 1;
    const { reply, source } = await sendToJane(id, question, {
      client,
      now: new Date(NOW.getTime() + minute * 60_000),
    });
    expect(source).toBe("rules");
    const guard = checkGuardrails(
      reply.body,
      dollarFigures(reply.body).map((f) => f.cents),
      undefined,
      "standard",
    );
    expect(guard.ok ? [] : guard.issues, reply.body).toEqual([]);
    return reply.body;
  };

  it("names each fee given back, with the fee it was for", async () => {
    const user = await client.user.create({
      data: { email: `fee-facts-${crypto.randomUUID()}@example.com` },
    });
    people.push(user.id);
    const checking = await client.account.create({
      data: {
        userId: user.id,
        source: "csv",
        name: "Wells Fargo checking",
        type: "depository",
        subtype: "checking",
        currentBalanceCents: 141_222,
      },
    });
    const tx = (date: string, amountCents: number, description: string, pfc: string | null) => ({
      userId: user.id,
      accountId: checking.id,
      source: "csv" as const,
      dedupeKey: `${date}-${description}-${amountCents}`,
      date: new Date(`${date}T00:00:00Z`),
      amountCents,
      description,
      merchantName: null,
      pfcPrimary: pfc ? "BANK_FEES" : null,
      pfcDetailed: pfc,
      categorySource: "rule" as const,
    });
    await client.transaction.createMany({
      data: [
        tx("2026-07-31", 3_500, "OVERDRAFT FEE FOR A $6.20 ITEM", "BANK_FEES_OVERDRAFT_FEES"),
        tx("2026-08-02", -3_500, "OVERDRAFT FEE REVERSAL", "BANK_FEES_OVERDRAFT_FEES"),
        tx("2026-09-30", 1_000, "MONTHLY SERVICE FEE", "BANK_FEES_OTHER_BANK_FEES"),
        tx("2026-10-31", 1_000, "MONTHLY SERVICE FEE", "BANK_FEES_OTHER_BANK_FEES"),
        tx("2026-11-02", -1_000, "MONTHLY SERVICE FEE REFUND", null),
        tx("2026-11-01", 95_000, "BRIDGE APTS RENT", "RENT_AND_UTILITIES_RENT"),
      ],
    });
    for (const q of [
      "Did my fee get refunded?",
      "Which fees were removed?",
      "Was my overdraft fee reversed?",
    ]) {
      const body = await ask(user.id, q);
      expect(body, q).toContain("2 fees were given back");
      expect(body, q).toContain(
        "$35.00 back on Aug 2 on Wells Fargo checking, for an overdraft fee of that amount on Jul 31",
      );
      expect(body, q).toContain("$10.00 back on Nov 2");
      expect(body, q).not.toContain("according to");
    }
  });

  it("says none was given back on upload S7, with what was charged, and keeps the waiver rule", async () => {
    const id = await createCellPerson(
      "src/lib/jane-agent/checks/__fixtures__/cells/upload-s7-desktop",
      { client, now: NOW },
    );
    people.push(id);
    const body = await ask(id, "Did my fee get refunded?");
    expect(body).toMatch(
      /^I don't see a fee given back in your accounts\. They show \$60\.00 in 5 fees/,
    );
    expect(await ask(id, "Can my bank fee be waived?")).toContain(
      "according to Bank of America's own page",
    );
  });
});
