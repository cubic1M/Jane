import { randomBytes } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import type { PlaidApi } from "plaid";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));

import { track } from "@/lib/analytics";
import { gather } from "@/lib/jane-agent/brain";
import { runChatTool } from "@/lib/jane-agent/claude-tools";
import { loadSnapshot } from "@/lib/jane-agent/snapshot";
import { sendToJane } from "@/lib/jane-agent/typing";
import { linkDemoBank } from "@/lib/plaid/demo";
import { syncItem } from "@/lib/plaid/sync";
import { DebtTermsError, checkDebtTerms, clearDebtTerms, loadDebts, saveDebtTerms } from "./debts";

// Spec step 109 against a real, migrated Postgres, on the demo bank: every loan and card
// with its bank details, the Affirm and Klarna plans found from payments, the total equal to
// what net worth counts, typed terms for what the bank leaves out, and the same numbers in
// Jane's chat (rule answers, the message source and Claude's tool).

const url = process.env.TEST_DATABASE_URL;
const LINKED = new Date("2026-10-18T15:00:00Z");

describe.runIf(url)("every debt in one place against a real database", () => {
  let client: PrismaClient;
  let userId: string;
  let otherId: string;
  const created: string[] = [];
  const plaid = new Proxy(
    {},
    {
      get: () => () => {
        throw new Error("The demo bank must never call Plaid");
      },
    },
  ) as PlaidApi;
  const opts = () => ({ client, now: LINKED });

  async function person(prefix: string) {
    const user = await client.user.create({
      data: { email: `${prefix}-${crypto.randomUUID()}@example.com` },
    });
    created.push(user.id);
    return user.id;
  }

  beforeAll(async () => {
    vi.stubEnv("TOKEN_ENCRYPTION_KEY", randomBytes(32).toString("base64"));
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    vi.stubEnv("PLAID_CLIENT_ID", "");
    vi.stubEnv("PLAID_SECRET", "");
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
    userId = await person("debts-demo");
    otherId = await person("debts-other");
    const { itemId } = await linkDemoBank(userId, { client, now: LINKED });
    await syncItem(itemId, { client, api: plaid, now: LINKED });
  }, 120_000);
  afterAll(async () => {
    await client.user.deleteMany({ where: { id: { in: created } } });
    await client.$disconnect();
    vi.unstubAllEnvs();
  });

  it("has every loan, card and plan, each rate with where it came from", async () => {
    const book = await loadDebts(userId, opts());
    const names = book.debts.map((d) => d.name);
    expect(names).toEqual(
      expect.arrayContaining([
        "Demo Credit Card ····0003",
        "Demo Home Loan ····0004",
        "Demo Student Loan ····0005",
        "Demo Car Loan ····0006",
        "Klarna Pay in 4",
        "Affirm plan",
      ]),
    );
    const car = book.debts.find((d) => d.kind === "auto")!;
    expect(car).toMatchObject({ aprBps: 690, aprFrom: "bank", payoffFrom: "bank" });
    const klarna = book.debts.find((d) => d.name === "Klarna Pay in 4")!;
    expect(klarna).toMatchObject({
      aprBps: 0,
      aprFrom: "terms",
      balanceCents: 12_450,
      balanceFrom: "payments",
      description: "2 of 4 payments made",
    });
    // Affirm's balance and rate aren't in the payments: Jane asks for them.
    expect(book.missingRate.map((d) => d.name)).toEqual(["Affirm plan"]);
    for (const debt of book.debts) {
      if (debt.aprBps !== null) expect(debt.aprFrom).not.toBeNull();
    }
  });

  it("adds up loans and cards to what net worth counts as owed", async () => {
    const book = await loadDebts(userId, opts());
    const worth = JSON.parse((await runChatTool(userId, "net_worth", {}, opts())).content);
    const tool = await runChatTool(userId, "debts", {}, opts());
    const debts = JSON.parse(tool.content);
    expect(debts.loansAndCardsOwed).toBe(worth.owes);
    expect(book.totalOwedCents).toBe(book.accountsOwedCents + 12_450);
    // Every figure the tool gave is recorded for the guardrails.
    expect(tool.cents).toContain(book.accountsOwedCents);
    expect(tool.cents).toContain(12_450);
    expect(
      debts.debts.find((d: { name: string }) => d.name === "Demo Car Loan ····0006"),
    ).toMatchObject({
      rate: "6.90%",
      rateFrom: "from your bank",
    });
  });

  it("answers how much is owed and when the car is paid off, by rules", async () => {
    const owe = await sendToJane(userId, "How much do I owe?", opts());
    expect(owe.reply.body).toMatch(
      /^You owe \$[\d,]+\.\d\d on 4 loans and cards, the same as your net worth counts\./,
    );
    expect(owe.reply.body).toContain("Klarna Pay in 4: $124.50 at 0.00%");
    expect(owe.reply.body).toContain("I don't have a rate for Affirm plan.");
    expect(owe.reply.actions).toEqual([
      { id: "open", label: "See every debt", kind: "link", href: "/loans" },
    ]);
    const car = await sendToJane(userId, "When is my car paid off?", {
      ...opts(),
      now: new Date(LINKED.getTime() + 1000),
    });
    expect(car.reply.body).toContain(
      "Your Demo Car Loan ····0006: $18,020.00 left at 6.90% fixed (from your bank).",
    );
    // Where its $494.10 payment ends it (the sample loans agree with themselves, loans QA).
    expect(car.reply.body).toMatch(/It's paid off by \w{3} 1, 2030 \(from your bank\)\./);
    expect(track).toHaveBeenCalledWith(userId, "chat_message_sent", {
      intent: "debt_detail",
      source: "rules",
    });
  });

  it("tells the person about the plans it found, once each", async () => {
    const snapshot = await loadSnapshot(userId, opts());
    const messages = gather(snapshot!, LINKED, { trigger: "sync" }).filter(
      (m) => m.source === "debts",
    );
    expect(messages.map((m) => m.dedupeKey).sort()).toEqual([
      "debts:found:bnpl:affirm:8950",
      "debts:found:bnpl:klarna:6225",
    ]);
    const klarna = messages.find((m) => m.dedupeKey.includes("klarna"))!;
    expect(klarna.body).toBe(
      "I found your Klarna Pay in 4 from your payments: 2 of 4 payments made, $124.50 left, the last payment on Nov 12. I've added it to your debts. It's 0.00%: pay in 4 plans charge no interest under the company's own terms.",
    );
  });

  it("saves typed terms for a plan, only what the bank doesn't report", async () => {
    await saveDebtTerms(
      userId,
      {
        debtKey: "bnpl:affirm:8950",
        apr: "15",
        minimum: "",
        balance: "537",
        payoffDate: "2027-04-12",
      },
      opts(),
    );
    const affirm = (await loadDebts(userId, opts())).debts.find((d) => d.name === "Affirm plan")!;
    expect(affirm).toMatchObject({
      aprBps: 1500,
      aprFrom: "typed",
      balanceCents: 53_700,
      balanceFrom: "typed",
      payoffDate: "2027-04-12",
      typedOn: "2026-10-18",
    });
    expect(track).toHaveBeenCalledWith(userId, "debt_terms_saved", { kind: "bnpl" });

    // An account's balance always comes from the bank.
    const card = (await loadDebts(userId, opts())).debts.find((d) => d.kind === "card")!;
    await expect(
      saveDebtTerms(
        userId,
        { debtKey: card.key, apr: "", minimum: "", balance: "10", payoffDate: "" },
        opts(),
      ),
    ).rejects.toThrow("The balance comes from your bank.");

    await clearDebtTerms(userId, "bnpl:affirm:8950", opts());
    expect(
      (await loadDebts(userId, opts())).debts.find((d) => d.name === "Affirm plan")?.aprBps,
    ).toBeNull();
  });

  it("never saves terms on someone else's debt", async () => {
    const card = (await loadDebts(userId, opts())).debts.find((d) => d.kind === "card")!;
    await expect(
      saveDebtTerms(
        otherId,
        { debtKey: card.key, apr: "20", minimum: "", balance: "", payoffDate: "" },
        opts(),
      ),
    ).rejects.toThrow("That isn't one of your debts.");
    expect(await client.debtTerms.count({ where: { userId: otherId } })).toBe(0);
    expect((await loadDebts(otherId, opts())).debts).toEqual([]);
  });
});

describe("typed debt terms", () => {
  const input = { debtKey: "k", apr: "", minimum: "", balance: "", payoffDate: "" };
  it("checks every field", () => {
    expect(checkDebtTerms({ ...input, apr: "24.99", minimum: "35" }, "2026-10-18")).toEqual({
      aprBps: 2499,
      minimumPaymentCents: 3500,
      balanceCents: null,
      payoffDate: null,
    });
    expect(() => checkDebtTerms(input, "2026-10-18")).toThrow(DebtTermsError);
    expect(() => checkDebtTerms({ ...input, apr: "lots" }, "2026-10-18")).toThrow(
      /yearly percentage/,
    );
    expect(() => checkDebtTerms({ ...input, minimum: "-5" }, "2026-10-18")).toThrow(
      /monthly payment/,
    );
    expect(() => checkDebtTerms({ ...input, payoffDate: "2026-02-30" }, "2026-10-18")).toThrow(
      /payoff date/,
    );
    expect(() => checkDebtTerms({ ...input, payoffDate: "2026-01-01" }, "2026-10-18")).toThrow(
      /in the past/,
    );
  });
});
