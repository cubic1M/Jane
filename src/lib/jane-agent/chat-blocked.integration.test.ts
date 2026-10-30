import { randomBytes } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));

import { reapplyRules } from "@/categorize/reapply";
import { CANT_ADVISE_TAX, resetClaudeHealth } from "./claude";
import { runChatTool } from "./claude-tools";
import { sendToJane } from "./typing";

// The chat-blocked bench (founder 10-30, free: Claude is played back, no API call). "How much tax
// will I have to pay because of Lucid Trading? How much did I earn from them, how much did I
// actually spend for that earning" was blocked twice by the guardrails, and the rules then
// answered "spending on earning" with an unrelated category breakdown. For tricky multi-part and
// tax-adjacent questions, a blocked or failed Claude never yields an answer about something else,
// and the facts in a blocked answer survive it. Made-up rows shaped like a prop trading firm's
// payouts and fees, never anyone's real data.

const url = process.env.TEST_DATABASE_URL;
const NOW = new Date("2026-10-30T07:00:00Z");

type Fixture = [date: string, cents: number, description: string, detailed: string, source: string];
const ROWS: Fixture[] = [
  // A prop firm: two payouts the rules know, one the bank filed as a transfer, and its fees.
  ["2026-08-14", -150_000, "LUCID TRADING PAYOUT ACH CREDIT", "INCOME_CONTRACTOR", "rule"],
  ["2026-09-12", -120_000, "LUCID TRADING PAYOUT ACH CREDIT", "INCOME_CONTRACTOR", "rule"],
  ["2026-10-09", -50_000, "LUCID TRADING LLC ACH DEPOSIT", "TRANSFER_IN_ACCOUNT_TRANSFER", "plaid"],
  [
    "2026-07-02",
    14_900,
    "LUCIDTRADING.COM EVALUATION",
    "GENERAL_SERVICES_OTHER_GENERAL_SERVICES",
    "rule",
  ],
  [
    "2026-07-20",
    8_500,
    "LUCID TRADING RESET FEE",
    "GENERAL_SERVICES_OTHER_GENERAL_SERVICES",
    "rule",
  ],
  [
    "2026-08-03",
    14_900,
    "LUCIDTRADING.COM EVALUATION",
    "GENERAL_SERVICES_OTHER_GENERAL_SERVICES",
    "rule",
  ],
  // A marketplace side income.
  ["2026-09-20", -42_000, "ETSY PAYOUT", "INCOME_GIG_ECONOMY", "rule"],
  ["2026-09-21", 3_150, "ETSY.COM SELLER FEES", "GENERAL_SERVICES_OTHER_GENERAL_SERVICES", "rule"],
  // Everyday spending: what an unrelated breakdown would be made of.
  ["2026-10-02", 1_549, "NETFLIX.COM", "ENTERTAINMENT_TV_AND_MOVIES", "rule"],
  ["2026-10-05", 48_065, "GEEK SQUAD SERVICES", "GENERAL_SERVICES_OTHER_GENERAL_SERVICES", "rule"],
  ["2026-10-06", 14_035, "TARGET 00012345", "GENERAL_MERCHANDISE_SUPERSTORES", "rule"],
  ["2026-10-01", -400_000, "ACME CORP PAYROLL", "INCOME_SALARY", "rule"],
];
// What came in from each payee and what went out to it, in the rows above.
const PAYEES = {
  lucid: { name: "Lucid Trading", in: "$3,200.00", out: "$383.00" },
  etsy: { name: "Etsy", in: "$420.00", out: "$31.50" },
} as const;

type Case = { text: string; payee: keyof typeof PAYEES | null };
const QUESTIONS: Case[] = [
  {
    text: "How much tax will I have to pay because of lucid trading? How much did I earn from them, how much did I actually spend for that earning",
    payee: "lucid",
  },
  { text: "what did I earn from Lucid Trading and spend to get it?", payee: "lucid" },
  { text: "how much tax on my side income from etsy?", payee: "etsy" },
  { text: "can I deduct my lucid trading fees?", payee: "lucid" },
  { text: "is my lucid trading income taxable, and how much did they pay me", payee: "lucid" },
  {
    text: "how much tax will I owe on my etsy sales, and what did etsy charge me in fees?",
    payee: "etsy",
  },
  { text: "can I deduct my home office?", payee: null },
  { text: "how much tax do I owe on my side income and what can I write off?", payee: null },
  { text: "how much did I actually spend for that earning", payee: null },
];

// Answers about something else: a category breakdown, a category that isn't one, the whole picture.
const ELSEWHERE =
  /The most went to|couldn't find spending on|here is where you stand|Services \$480\.65/i;
const ADVICE = "You should deduct those fees and put the payouts on Schedule C.";

// Claude, played back. "blocked": advice only, every time. "failed": nothing comes back.
// "facts": looks the payee up, then writes the lookup's figures with advice after them, every time.
type Mode = "blocked" | "failed" | "facts";
function claudeFor(mode: Mode, payee: Case["payee"]) {
  const reply = (content: unknown[], stop = "end_turn") => ({
    stop_reason: stop,
    content,
    usage: { input_tokens: 10, output_tokens: 10 },
  });
  return () =>
    ({
      messages: {
        stream: (params: { messages: { role: string; content: unknown }[] }) => {
          // The lookup's result, once Claude has asked for it (the history comes before it).
          const toolResult = params.messages
            .flatMap((m) => (Array.isArray(m.content) ? m.content : []))
            .find((b: { type: string }) => b.type === "tool_result") as
            { content: string } | undefined;
          let message;
          if (mode === "failed") message = reply([]);
          else if (mode === "blocked" || !payee) message = reply([{ type: "text", text: ADVICE }]);
          else if (!toolResult) {
            message = reply(
              [
                {
                  type: "tool_use",
                  id: "t1",
                  name: "search_transactions",
                  input: { merchant: payee, from: "2026-01-01" },
                },
              ],
              "tool_use",
            );
          } else {
            const found = JSON.parse(toolResult.content) as {
              totalMoneyIn: string;
              totalMoneyOut: string;
            };
            message = reply([
              {
                type: "text",
                text: `${PAYEES[payee].name} paid you ${found.totalMoneyIn} this year, and you paid it ${found.totalMoneyOut}. ${ADVICE}`,
              },
            ]);
          }
          const stream = { on: () => stream, finalMessage: async () => message };
          return stream;
        },
      },
    }) as never;
}

describe.runIf(url)("chat-blocked bench", { timeout: 300_000 }, () => {
  let client: PrismaClient;
  let userId: string;
  let tick = 0;
  beforeAll(async () => {
    vi.stubEnv("TOKEN_ENCRYPTION_KEY", randomBytes(32).toString("base64"));
    vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
    vi.stubEnv("CHAT_MONTHLY_CAP_CENTS", "1000000000");
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "info").mockImplementation(() => {});
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
    userId = (
      await client.user.create({ data: { email: `cb-${crypto.randomUUID()}@example.com` } })
    ).id;
    const account = await client.account.create({
      data: { userId, source: "csv", name: "Checking", type: "depository" },
    });
    await client.transaction.createMany({
      data: ROWS.map(([date, amountCents, description, detailed, source], i) => ({
        userId,
        accountId: account.id,
        source: "csv",
        dedupeKey: `cb-${i}`,
        date: new Date(`${date}T00:00:00Z`),
        amountCents,
        description,
        pfcPrimary: detailed.startsWith("GENERAL_SERVICES")
          ? "GENERAL_SERVICES"
          : detailed.startsWith("GENERAL_MERCHANDISE")
            ? "GENERAL_MERCHANDISE"
            : detailed.split("_")[0] === "TRANSFER"
              ? "TRANSFER_IN"
              : detailed.split("_")[0],
        pfcDetailed: detailed,
        categorySource: source as "rule" | "plaid",
      })),
    });
    // The nightly re-apply: the payout the bank called a transfer is income from now on.
    await reapplyRules(userId, { client });
  });
  afterAll(async () => {
    await client.user.deleteMany({ where: { id: userId } });
    await client.$disconnect();
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("a prop firm's payouts are income and its fees spending, found by its name", async () => {
    const payout = await client.transaction.findFirstOrThrow({
      where: { userId, description: "LUCID TRADING LLC ACH DEPOSIT" },
      select: { pfcPrimary: true, pfcDetailed: true },
    });
    expect(payout).toEqual({ pfcPrimary: "INCOME", pfcDetailed: "INCOME_CONTRACTOR" });
    const found = JSON.parse(
      (
        await runChatTool(
          userId,
          "search_transactions",
          { merchant: "lucid", from: "2026-01-01" },
          { client, now: NOW },
        )
      ).content,
    );
    expect(found).toMatchObject({
      matched: 6,
      totalMoneyIn: PAYEES.lucid.in,
      totalMoneyOut: PAYEES.lucid.out,
    });
  });

  const ask = async (text: string, mode: Mode, payee: Case["payee"]) => {
    resetClaudeHealth();
    tick += 1;
    return sendToJane(userId, text, {
      client,
      now: new Date(NOW.getTime() + tick * 2 * 60_000),
      claude: claudeFor(mode, payee),
      primerMs: 60_000,
    });
  };

  describe.each(["blocked", "failed"] as const)("when Claude is %s", (mode) => {
    it.each(QUESTIONS)("never answers something else: $text", async ({ text, payee }) => {
      const { reply, source } = await ask(text, mode, payee);
      expect(source, text).toBe(mode === "blocked" ? "claude_blocked" : "claude_unavailable");
      expect(reply.body, text).not.toMatch(ELSEWHERE);
      expect(reply.body, text).not.toContain(ADVICE);
      if (payee) {
        // What Jane can see for the name they typed, in and out.
        expect(reply.body, text).toContain(PAYEES[payee].name);
        expect(reply.body, text).toContain(PAYEES[payee].in);
        expect(reply.body, text).toContain(PAYEES[payee].out);
      }
      if (/\btax|deduct|write off\b/i.test(text) && payee) {
        expect(reply.body, text).toMatch(/can't tell you what to file or deduct/);
      }
    });
  });

  describe("when Claude's answer is blocked for its advice", () => {
    it.each(QUESTIONS.filter((q) => q.payee))(
      "keeps its facts and drops only the advice: $text",
      async ({ text, payee }) => {
        const { reply, source } = await ask(text, "facts", payee);
        expect(source, text).toBe("claude");
        expect(reply.body, text).toBe(
          `${PAYEES[payee!].name} paid you ${PAYEES[payee!].in} this year, and you paid it ${PAYEES[payee!].out}. ${CANT_ADVISE_TAX}`,
        );
      },
    );
  });
});
