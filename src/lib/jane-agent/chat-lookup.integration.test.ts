import { randomBytes } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import Anthropic from "@anthropic-ai/sdk";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));

import { chatModelLine } from "@/lib/chat-model-health";
import { resetClaudeHealth } from "./claude";
import { resetChatModelDownLog } from "./service-down";
import { sendToJane } from "./typing";

// The founder's question, "did I buy something from california arts before", and the other
// everyday lookups, end to end with a SCRIPTED Claude (no model call, no cost): Claude asks for
// the search tool, the tool reads the person's rows, and the answer is written from what it
// returned. And what the person is told when Claude can't be reached.

const url = process.env.TEST_DATABASE_URL;
const NOW = new Date("2026-11-28T18:00:00Z");
const day = (date: string) => new Date(`${date}T00:00:00Z`);

type Call = { tool: string; input: Record<string, unknown> };
type Result = Record<string, unknown> & {
  transactions?: { date: string; amount: string; merchant: string; account?: string }[];
};

// Claude, played back: the first round asks for the tool, the next writes `say(result)`.
function scripted(call: Call, say: (result: Result) => string, seen: string[] = []) {
  return () =>
    ({
      messages: {
        stream: (params: { messages: { role: string; content: unknown }[] }) => {
          const last = params.messages.at(-1);
          const results = Array.isArray(last?.content)
            ? (last.content as { type: string; content?: string }[]).filter(
                (b) => b.type === "tool_result",
              )
            : [];
          const stream = {
            on: () => stream,
            abort() {},
            finalMessage: async () => {
              if (results.length === 0) {
                return {
                  stop_reason: "tool_use",
                  content: [
                    { type: "tool_use", id: "toolu_1", name: call.tool, input: call.input },
                  ],
                  usage: { input_tokens: 10, output_tokens: 10 },
                };
              }
              const result = JSON.parse(String(results[0].content)) as Result;
              seen.push(JSON.stringify(result));
              return {
                stop_reason: "end_turn",
                content: [{ type: "text", text: say(result) }],
                usage: { input_tokens: 10, output_tokens: 10 },
              };
            },
          };
          return stream;
        },
      },
    }) as never;
}

describe.runIf(url)(
  "the chat looks anything up in the person's own money",
  { timeout: 120_000 },
  () => {
    let client: PrismaClient;
    let me = "";
    let other = "";
    let tick = 0;
    const ask = (question: string, claude: ReturnType<typeof scripted>, userId = me) =>
      sendToJane(userId, question, {
        client,
        now: new Date(NOW.getTime() + ++tick * 120_000),
        claude,
        primerMs: 60_000,
      });

    beforeAll(async () => {
      vi.stubEnv("TOKEN_ENCRYPTION_KEY", randomBytes(32).toString("base64"));
      vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
      vi.stubEnv("CHAT_MONTHLY_CAP_CENTS", "1000000000");
      client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
      const seed = async (who: string, rows: [string, number, string, string?][]) => {
        const user = await client.user.create({
          data: { email: `lookup-${who}-${crypto.randomUUID()}@example.com`, timezone: "UTC" },
        });
        const checking = await client.account.create({
          data: {
            userId: user.id,
            source: "csv",
            name: "Everyday Checking",
            mask: "4821",
            type: "depository",
            subtype: "checking",
            currentBalanceCents: 412_377,
          },
        });
        await client.account.create({
          data: {
            userId: user.id,
            source: "csv",
            name: "Travel Card",
            mask: "9902",
            type: "credit",
            subtype: "credit card",
            currentBalanceCents: 85_010,
          },
        });
        await client.transaction.createMany({
          data: rows.map(([date, amountCents, description, primary], i) => ({
            userId: user.id,
            accountId: checking.id,
            source: "csv" as const,
            dedupeKey: `${who}-${i}`,
            date: day(date),
            amountCents,
            description,
            merchantName: null,
            pfcPrimary: primary ?? "GENERAL_MERCHANDISE",
            pfcDetailed: null,
            categorySource: "rule" as const,
          })),
        });
        return user.id;
      };
      me = await seed("me", [
        ["2024-02-10", 1_200, "WHOLE FOODS 0412", "FOOD_AND_DRINK"],
        ["2025-03-14", 4_820, "CALIFORNIA ARTS 0412 SAN FRANCISCO CA"],
        ["2025-09-02", 3_175, "POS DEBIT CA ARTS SUPPLY #12"],
        ["2026-01-20", 4_318, "SQ *CORNER BAKERY"],
        ["2026-09-05", -320_000, "ACME CORP PAYROLL", "INCOME"],
        ["2026-09-19", -320_000, "ACME CORP PAYROLL", "INCOME"],
        ["2026-10-04", 6_450, "TRADER JOES 118", "FOOD_AND_DRINK"],
        ["2026-10-17", 9_999, "SAFEWAY 1020", "FOOD_AND_DRINK"],
        ["2026-10-30", 24_900, "BEST BUY 00123"],
        ["2026-11-02", 18_000, "BEST BUY 00123"],
        ["2026-11-10", -18_000, "BEST BUY 00123 RETURN"],
      ]);
      other = await seed("other", [["2026-10-01", 7_777, "CALIFORNIA ARTS OTHER PERSON ONLY"]]);
    });
    afterAll(async () => {
      await client.user.deleteMany({ where: { id: { in: [me, other] } } });
      await client.$disconnect();
      vi.unstubAllEnvs();
    });
    beforeEach(() => {
      resetClaudeHealth();
      resetChatModelDownLog();
    });

    it("answers 'did I buy something from california arts before' from every year of history", async () => {
      const seen: string[] = [];
      const { reply, source } = await ask(
        "did I buy something from california arts before",
        scripted(
          { tool: "search_transactions", input: { merchant: "california arts" } },
          (r) =>
            `Yes. You bought from California Arts on ${r.transactions?.[0].date} for ${r.transactions?.[0].amount}. A similar name, CA Arts Supply, shows one more on 2025-09-02 for $31.75.`,
          seen,
        ),
      );
      expect(source).toBe("claude");
      expect(reply.body).toContain("2025-03-14");
      expect(reply.body).toContain("$48.20");
      expect(reply.body).toContain("$31.75");
      // What the tool gave: the exact one, the near one labelled, the first and last date, the
      // bank's own words, the account; and never the other person's row.
      const result = JSON.parse(seen[0]);
      expect(result).toMatchObject({ matched: 1, firstDate: "2025-03-14", lastDate: "2025-03-14" });
      expect(result.transactions[0]).toMatchObject({
        bankText: "CALIFORNIA ARTS … SAN FRANCISCO CA",
        inAccount: "Everyday Checking ····4821",
      });
      expect(result.similarName).toMatchObject({ matched: 1 });
      expect(seen[0]).not.toContain("OTHER PERSON");
      expect(seen[0]).not.toContain("77.77");
    });

    it("says plainly that nothing matches and where the data starts, never 'please ask again'", async () => {
      const seen: string[] = [];
      const { reply } = await ask(
        "did I ever buy anything from zzz hardware",
        scripted(
          { tool: "search_transactions", input: { merchant: "zzz hardware" } },
          (r) =>
            `No, there is no purchase from ZZZ Hardware in the data I have, which runs from ${r.dataStarts} to ${r.dataEnds}. I can't see anything before that.`,
          seen,
        ),
      );
      expect(JSON.parse(seen[0])).toMatchObject({
        matched: 0,
        dataStarts: "2024-02-10",
        dataEnds: "2026-11-10",
      });
      expect(JSON.parse(seen[0]).note).toMatch(/runs from 2024-02-10/);
      expect(reply.body).toMatch(/no purchase from ZZZ Hardware/);
      expect(reply.body).toContain("2024-02-10");
      expect(reply.body).not.toMatch(/ask again/i);
    });

    // The other everyday shapes: what Claude would call, and that the tool answers it.
    const shapes: {
      question: string;
      call: Call;
      check: (r: Result) => void;
      say: (r: Result) => string;
      expectIn: RegExp;
    }[] = [
      {
        question: "how much did I spend at best buy this year",
        call: { tool: "search_transactions", input: { merchant: "best buy", from: "2026-01-01" } },
        check: (r) =>
          expect(r).toMatchObject({
            matched: 3,
            totalMoneyOut: "$429.00",
            totalMoneyIn: "$180.00",
          }),
        say: (r) => `You spent ${r.totalMoneyOut} at Best Buy this year.`,
        expectIn: /\$429\.00/,
      },
      {
        question: "when did I last pay best buy",
        call: {
          tool: "search_transactions",
          input: { merchant: "best buy", direction: "out" },
        },
        check: (r) => expect(r.transactions?.[0]).toMatchObject({ date: "2026-11-02" }),
        say: (r) => `Your last Best Buy payment was on ${r.transactions?.[0].date}.`,
        expectIn: /2026-11-02/,
      },
      {
        question: "what was that $43.18 charge",
        call: { tool: "search_transactions", input: { min_amount: 43.18, max_amount: 43.18 } },
        check: (r) =>
          expect(r.transactions).toEqual([
            expect.objectContaining({ date: "2026-01-20", amount: "$43.18" }),
          ]),
        say: (r) =>
          `That was ${r.transactions?.[0].amount} on ${r.transactions?.[0].date} at ${r.transactions?.[0].merchant}.`,
        expectIn: /\$43\.18 on 2026-01-20/,
      },
      {
        question: "what did I spend on food in October",
        call: {
          tool: "search_transactions",
          input: { category: "Food and drink", from: "2026-10-01", to: "2026-10-31" },
        },
        check: (r) => expect(r).toMatchObject({ matched: 2, totalMoneyOut: "$164.49" }),
        say: (r) => `You spent ${r.totalMoneyOut} on food and drink in October.`,
        expectIn: /\$164\.49/,
      },
      {
        question: "what's my biggest purchase this year",
        call: {
          tool: "search_transactions",
          input: { from: "2026-01-01", direction: "out", sort: "largest" },
        },
        check: (r) => expect(r.transactions?.[0]).toMatchObject({ amount: "$249.00" }),
        say: (r) =>
          `Your biggest purchase this year was ${r.transactions?.[0].amount} on ${r.transactions?.[0].date}.`,
        expectIn: /\$249\.00 on 2026-10-30/,
      },
      {
        question: "how much did I get paid in September",
        call: {
          tool: "search_transactions",
          input: { category: "Income", from: "2026-09-01", to: "2026-09-30", direction: "in" },
        },
        check: (r) => expect(r).toMatchObject({ matched: 2, totalMoneyIn: "$6,400.00" }),
        say: () => `You were paid $6,400.00 in September, in two paychecks.`,
        expectIn: /\$6,400\.00/,
      },
      {
        question: "did I get a refund from best buy",
        call: { tool: "search_transactions", input: { merchant: "best buy", direction: "in" } },
        check: (r) =>
          expect(r.transactions).toEqual([
            expect.objectContaining({ date: "2026-11-10", amount: "$180.00" }),
          ]),
        say: (r) => `Yes, Best Buy refunded ${r.transactions?.[0].amount} on 2026-11-10.`,
        expectIn: /\$180\.00 on 2026-11-10/,
      },
      {
        question: "what's my balance in my travel card",
        call: { tool: "account_balances", input: {} },
        check: (r) =>
          expect(r.accounts).toEqual(
            expect.arrayContaining([
              expect.objectContaining({ account: "Travel Card ····9902", owed: "$850.10" }),
              expect.objectContaining({
                account: "Everyday Checking ····4821",
                balance: "$4,123.77",
              }),
            ]),
          ),
        say: () => `You owe $850.10 on your Travel Card.`,
        expectIn: /\$850\.10/,
      },
    ];
    it.each(shapes)("answers '$question'", async ({ question, call, check, say, expectIn }) => {
      const seen: string[] = [];
      const { reply, source } = await ask(question, scripted(call, say, seen));
      check(JSON.parse(seen[0]));
      expect(source).toBe("claude");
      expect(reply.body).toMatch(expectIn);
    });

    it("never returns another person's rows, whoever is asked", async () => {
      const seen: string[] = [];
      await ask(
        "did I buy something from california arts before",
        scripted(
          { tool: "search_transactions", input: { merchant: "california arts" } },
          () => "Yes.",
          seen,
        ),
        other,
      );
      const result = JSON.parse(seen[0]);
      expect(result.matched).toBe(1);
      expect(result.transactions[0].date).toBe("2026-10-01");
      expect(seen[0]).not.toMatch(/2025-03-14|SAN FRANCISCO/);
    });

    describe("when Claude can't be reached", () => {
      const refused = () =>
        ({
          messages: {
            stream: () => {
              const stream = {
                on: () => stream,
                abort() {},
                finalMessage: async () => {
                  throw new Anthropic.APIError(
                    401,
                    { type: "error", error: { type: "authentication_error", message: "no" } },
                    "401 invalid x-api-key",
                    new Headers(),
                  );
                },
              };
              return stream;
            },
          },
        }) as never;

      it("says the answering service is down, offers the page with the search filled in, and reports it", async () => {
        const { reply, source } = await ask(
          "did I buy something from california arts before",
          refused,
        );
        expect(source).toBe("claude_unavailable");
        expect(reply.body).toMatch(/answering service isn't available right now/);
        expect(reply.body).toMatch(/reported/);
        expect(reply.body).not.toMatch(/ask again|key|401|api/i);
        expect(reply.actions).toEqual([
          expect.objectContaining({ kind: "link", href: "/transactions?q=california%20arts" }),
        ]);
        // Reported: the red line on /admin/health.
        expect(await chatModelLine({ client, now: new Date(NOW.getTime() + 3_600_000) })).toMatch(
          /^Chat model unavailable: \d+ refused or failed calls? since 2026-11-28/,
        );
      });

      it("says it for any question, and no transactions search when no place is named", async () => {
        const { reply } = await ask("what do I owe on my cards", refused);
        expect(reply.body).toMatch(/answering service isn't available right now/);
        expect(JSON.stringify(reply.actions)).not.toContain("/transactions?q=");
      });
    });
  },
);
