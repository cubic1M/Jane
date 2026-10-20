import { randomBytes } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import type { PlaidApi } from "plaid";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));

import { runChatTool } from "@/lib/jane-agent/claude-tools";
import { costlyBorrowingSource } from "@/lib/jane-agent/sources/costly-borrowing";
import { loadSnapshot } from "@/lib/jane-agent/snapshot";
import { sendToJane } from "@/lib/jane-agent/typing";
import { parseRefs } from "@/lib/jane-agent/types";
import { linkDemoBank } from "@/lib/plaid/demo";
import { syncItem } from "@/lib/plaid/sync";
import { loadCostlyBorrowing } from "./costly-borrowing";

// Spec step 247 against a real, migrated Postgres, on the demo bank: each kind of costly
// short-term borrowing is found in its payments (payday loans, a card cash advance, overdraft
// fees, a pay advance app), costed in dollars and as a yearly rate, with the cheaper ways out.

const url = process.env.TEST_DATABASE_URL;
const LINKED = new Date("2026-10-18T15:00:00Z");
const MINUTE = 60 * 1000;
const context = { now: LINKED, local: { date: "2026-10-18", hour: 8 }, trigger: "open" as const };

describe.runIf(url)(
  "costly short-term borrowing against a real database",
  { timeout: 30_000 },
  () => {
    let client: PrismaClient;
    let userId: string;
    const created: string[] = [];
    const plaid = new Proxy(
      {},
      {
        get: () => () => {
          throw new Error("The demo bank must never call Plaid");
        },
      },
    ) as PlaidApi;
    let tick = 0;
    const later = () => new Date(LINKED.getTime() + ++tick * MINUTE);
    const opts = (now = LINKED) => ({ client, now });

    beforeAll(async () => {
      vi.stubEnv("TOKEN_ENCRYPTION_KEY", randomBytes(32).toString("base64"));
      vi.stubEnv("ANTHROPIC_API_KEY", "");
      vi.stubEnv("PLAID_CLIENT_ID", "");
      vi.stubEnv("PLAID_SECRET", "");
      client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
      const user = await client.user.create({
        data: { email: `costly-${crypto.randomUUID()}@example.com` },
      });
      userId = user.id;
      created.push(userId);
      const { itemId } = await linkDemoBank(userId, { client, now: LINKED });
      await syncItem(itemId, { client, api: plaid, now: LINKED });
    }, 120_000);
    afterAll(async () => {
      await client.user.deleteMany({ where: { id: { in: created } } });
      await client.$disconnect();
      vi.unstubAllEnvs();
    });

    it("finds every kind in the demo bank, with the cost in dollars and as a yearly rate", async () => {
      const d = await loadCostlyBorrowing(userId, opts());
      expect(d.kinds.map((k) => k.kind).sort()).toEqual([
        "cash_advance",
        "overdraft",
        "pay_app",
        "payday",
      ]);
      const by = Object.fromEntries(d.kinds.map((k) => [k.kind, k]));
      // Two $300 loans paid back as $345: $90 in fees, about 391% a year.
      expect(by.payday).toMatchObject({ count: 2, costCents: 9_000 });
      expect(by.payday.aprBps).toBeGreaterThan(38_000);
      expect(by.payday.aprBps).toBeLessThan(40_000);
      // $10 fee plus interest from day one on $200.
      expect(by.cash_advance.costCents).toBeGreaterThan(1_000);
      // Three $34 overdraft fees.
      expect(by.overdraft).toMatchObject({ count: 3, costCents: 10_200 });
      // A $5 tip on each of three $100 advances out for a week.
      expect(by.pay_app).toMatchObject({ count: 3, costCents: 1_500 });
      expect(by.pay_app.aprBps).toBeGreaterThan(20_000);
      expect(d.totalYearlyCents).toBe(
        by.payday.costCents +
          by.cash_advance.costCents +
          by.overdraft.costCents +
          by.pay_app.costCents,
      );
      expect(d.cycle).toBe(true);
      expect(d.alternatives.pal.aprBps).toBe(2_800);
      expect(d.alternatives.buffer.months).toBe(6);
    });

    it("brings it up once a quarter and answers in the chat, with the way out as demo advice", async () => {
      const snapshot = (await loadSnapshot(userId, opts()))!;
      const [m] = costlyBorrowingSource.gather(snapshot, context);
      expect(m).toMatchObject({ kind: "heads_up", dedupeKey: "costly:2026q4" });
      expect(m.body).toMatch(/^Costly short-term borrowing cost you \$[\d,.]+ over the last year/);
      const { reply } = await sendToJane(
        userId,
        "how much have payday loans and cash advances cost me",
        {
          client,
          now: later(),
        },
      );
      expect(reply.body).toMatch(
        /^Costly short-term borrowing cost you \$[\d,.]+ over the last year, across 4 kinds\./,
      );
      expect(reply.body).toContain("Payday loans: 2 times, $90.00 in fees");
      expect(reply.body).toContain("Cheaper ways out:");
      expect(reply.body).toContain("Credit union payday alternative loan (PAL)");
      expect(parseRefs(reply.refs).advice).toBe(true);
      const tool = JSON.parse((await runChatTool(userId, "costly_borrowing", {}, opts())).content);
      expect(tool.kinds).toHaveLength(4);
      expect(tool.cheaperWaysOut.payAlternativeLoan.ratePercent).toBe(28);
    });

    it("has nothing to say for someone who doesn't borrow this way", async () => {
      const user = await client.user.create({
        data: { email: `costly-none-${crypto.randomUUID()}@example.com` },
      });
      created.push(user.id);
      expect((await loadCostlyBorrowing(user.id, opts())).any).toBe(false);
      const { reply } = await sendToJane(user.id, "how much have payday loans cost me", {
        client,
        now: later(),
      });
      expect(reply.body).toMatch(/^I don't see payday loans/);
    });
  },
);
