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
import { runChatTool } from "./claude-tools";
import { loadChargeExplanation, readInvoiceFor } from "./invoice-for-charge";
import { sendToJane } from "./typing";

// "Why did I pay $100 to Vercel?" (founder 11-24), asked of the backup with Claude off, over a
// person whose Vercel charges went $20, $20, $20, $100, with Figma charged once. Every answer passes
// the guardrails. The Claude path's tools answer from the same function.
const url = process.env.TEST_DATABASE_URL;
const NOW = new Date("2026-11-22T18:00:00Z");
const CELL = "src/lib/jane-agent/checks/__fixtures__/cells/explain-charge";

describe.runIf(url)("explaining a charge", { timeout: 900_000 }, () => {
  let client: PrismaClient;
  let id: string;
  let minute = 0;

  beforeAll(async () => {
    vi.stubEnv("TOKEN_ENCRYPTION_KEY", randomBytes(32).toString("base64"));
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url! }) });
    id = await createCellPerson(CELL, { client, now: NOW });
  });

  afterAll(async () => {
    await deleteCheckPerson(id, { client }).catch(() => {});
    await client.$disconnect();
    vi.unstubAllEnvs();
  });

  const ask = async (question: string) => {
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
    return { body: reply.body, source, intent, actions: reply.actions };
  };

  const JUMP =
    "You paid Vercel $100.00 on Nov 20. You usually pay it $20.00 a month, so this is $80.00 more than usual; it is the first time it has been this high in what I can see.";

  it("answers each wording the same way: what, when, how much, the usual, the difference", async () => {
    for (const q of [
      "why did I pay $100 to Vercel",
      "Why did I pay $100 to Vercel on Nov 20?",
      "why was Vercel so high",
      "what is this $100 Vercel charge",
      "why did Vercel charge me so much",
      "why was I charged $100 by Vercel",
    ]) {
      const { body, intent, source } = await ask(q);
      expect(intent, q).toBe("charge_explain");
      expect(source, q).toBe("rules");
      expect(body, q).toContain(JUMP);
    }
  });

  it("says the bank's line doesn't say why, and offers the invoice with a link to it", async () => {
    const { body, actions } = await ask("why did I pay $100 to Vercel");
    expect(body).toContain("Your bank's line shows only who was paid and how much, not why.");
    expect(body).toContain("In general, a bill can rise when usage is added to a plan fee");
    expect(body).toContain("name the one that explains the extra $80.00");
    expect(actions[0]).toMatchObject({ label: "Read the invoice" });
    expect((actions[0] as { href: string }).href).toMatch(/^\/invoice\?charge=/);
  });

  it("says a price went up with the day, for 'why did it go up'", async () => {
    const { body, intent } = await ask("why did Vercel go up");
    expect(intent).toBe("charge_explain");
    expect(body).toContain(JUMP);
  });

  it("says a charge seen once is the only one, with no usual", async () => {
    const { body } = await ask("why did I pay $45 to Figma");
    expect(body).toContain("You paid Figma $45.00 on Nov 5. It's the only charge from Figma I see");
    expect(body).not.toMatch(/usually|more than usual/);
    expect(body).toContain("not why");
  });

  it("answers a variable bill against the middle of what came before", async () => {
    const { body } = await ask("why was my Xcel Energy bill so high");
    expect(body).toContain("You paid Xcel Energy $57.49 on Nov 10.");
    expect(body).toMatch(/more than usual; it is the first time it has been this high/);
  });

  it("falls back to the amount's own answer when no charge has that name", async () => {
    const { body, intent } = await ask("why did I pay $23.10 to the hardware store");
    expect(intent).toBe("charge_explain");
    expect(body).toMatch(/Ace Hardware|23\.10/);
  });

  it("says plainly when there is no charge by that name or amount", async () => {
    expect((await ask("why did I pay $300 to Netflix")).body).toMatch(/\$300\.00 charge/);
    expect((await ask("why was Netflix so high")).body).toContain(
      "I don't see a charge at netflix",
    );
  });

  it("leaves a bank fee and a charge with no name to their own answers", async () => {
    expect((await ask("why was I charged a maintenance fee")).intent).toBe("fee_why");
    expect((await ask("why was I charged $5.33")).intent).toBe("charge_amount");
  });

  it("reads the tools from the same function: explain_charge", async () => {
    const run = await runChatTool(
      id,
      "explain_charge",
      { merchant: "vercel", amount: 100 },
      { client, now: NOW },
    );
    const data = JSON.parse(run.content);
    expect(data.found).toBe(true);
    expect(data.paid).toEqual({ on: "2026-11-20", amount: "$100.00" });
    expect(data.usual).toEqual({ amount: "$20.00", aboutThat: false, aboutAMonth: true });
    expect(data.difference).toEqual({ amount: "$80.00", direction: "more" });
    expect(data.firstTimeThisHighInWhatIsSeen).toBe(true);
    expect(data.bankLineSaysWhy).toBe(false);
    expect(data.invoicePage).toMatch(/^\/invoice\?charge=/);
    expect(run.cents).toEqual(expect.arrayContaining([10_000, 2_000, 8_000]));
  });

  it("reads the tools from the same function: read_invoice names the lines", async () => {
    const run = await runChatTool(
      id,
      "read_invoice",
      {
        merchant: "vercel",
        amount: 100,
        text: "Pro plan  $20.00\nBandwidth overage, 150 GB  $60.00\nBuild minutes  $20.00\nTotal  $100.00",
      },
      { client, now: NOW },
    );
    const data = JSON.parse(run.content);
    expect(data.read).toBe(true);
    expect(data.setAgainstCharge.totalIsTheCharge).toBe(true);
    expect(data.setAgainstCharge.lineThatIsTheUsual).toEqual({
      line: "Pro plan",
      amount: "$20.00",
    });
    expect(data.setAgainstCharge.extra).toBe("$80.00");
    expect(
      data.setAgainstCharge.linesThatMakeUpTheExtra.map((l: { line: string }) => l.line),
    ).toEqual(["Bandwidth overage, 150 GB", "Build minutes"]);
  });

  it("reads a pasted invoice for a charge by its id, with nothing kept", async () => {
    const lines = await client.transaction.findMany({
      where: { userId: id, amountCents: 10_000 },
      select: { id: true },
    });
    expect(lines).toHaveLength(1);
    const explanation = await loadChargeExplanation(id, lines[0]!.id, { client, now: NOW });
    expect(explanation?.charge).toMatchObject({ date: "2026-11-20", cents: 10_000 });
    const before = await client.janeMessage.count({ where: { userId: id } });
    const answer = await readInvoiceFor(
      id,
      "Pro plan  $20.00\nOverage  $80.00\nTotal  $100.00",
      lines[0]!.id,
      { client, now: NOW },
    );
    expect(answer.ok).toBe(true);
    expect(answer.ok && answer.reading.join("\n")).toContain(
      "The Overage ($80.00) line accounts for the extra $80.00.",
    );
    // Nothing the invoice said was stored as a message.
    expect(await client.janeMessage.count({ where: { userId: id } })).toBe(before);
  });

  it("ignores an id that isn't one of their charges", async () => {
    const other = await readInvoiceFor(
      id,
      "Pro plan  $20.00\nTotal  $20.00",
      "not-my-transaction",
      {
        client,
        now: NOW,
      },
    );
    expect(other.ok && other.charge).toEqual([]);
  });
});
