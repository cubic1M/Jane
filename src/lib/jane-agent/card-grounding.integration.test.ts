import { randomBytes } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { FORECAST_SUBTYPES } from "@/config/detection";
import { PEOPLE } from "@/config/people";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));

import { addDays } from "@/detection/units";
import { unsupportedFigures } from "@/lib/guardrails";
import { formatCents } from "@/lib/money";
import { syncItem } from "@/lib/plaid/sync";
import { scanSuggestions } from "@/lib/suggestions";
import { startTrial } from "@/lib/trial";
import { loadFacts } from "./checks/facts";
import { runChatTool } from "./claude-tools";
import { loadPopupStack } from "./popup-stack";
import { runJaneAgent } from "./run";

// The dock and the chat agree (card-chat mismatch), for each of the eight sample people against
// a real, migrated Postgres, with no Claude call (free, so it runs on every PR):
// 1. Every figure on a card in Jane's dock is one the chat's own lookups give, by the guardrails'
//    rule: so the chat can say it after looking, and can't be stuck repeating the card.
// 2. The lookups' figures are the data's: each subscription's last charge and each deadline
//    from a purchase is found by the chat's transaction search, on its day and at its amount,
//    and the checking balance is the accounts'.

const url = process.env.TEST_DATABASE_URL;
const NOW = new Date("2026-10-18T15:00:00Z");
const DAY = 24 * 60 * 60 * 1000;
// The day the person signs up, and nine days on (a purchase's return window is closer then).
const DAYS = [0, 9];
// Jane's messages are written a millisecond apart from the run's time.
const opened = (d: Date) => new Date(d.getTime() + 60_000);

type Tool = (name: string, input?: object) => Promise<unknown>;

describe.runIf(url)("the dock and the chat agree for every sample person", () => {
  let client: PrismaClient;
  const made = new Map<string, string>();

  beforeAll(async () => {
    vi.stubEnv("TOKEN_ENCRYPTION_KEY", randomBytes(32).toString("base64"));
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    vi.stubEnv("PLAID_CLIENT_ID", "");
    vi.stubEnv("PLAID_SECRET", "");
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
    for (const p of PEOPLE) {
      const trial = await startTrial({ client, now: NOW, defer: true, person: p.id });
      await syncItem(trial.itemId, { client, now: NOW });
      made.set(p.id, trial.userId);
    }
  }, 600_000);
  afterAll(async () => {
    await client.user.deleteMany({ where: { id: { in: [...made.values()] } } });
    await client.$disconnect();
    vi.unstubAllEnvs();
  });

  it.each(PEOPLE)(
    "$id: each card's figures are in the chat's lookups",
    { timeout: 240_000 },
    async (person) => {
      const userId = made.get(person.id)!;
      await scanSuggestions(userId, { client, now: NOW });
      let shown = 0;
      for (const n of DAYS) {
        const now = new Date(NOW.getTime() + n * DAY);
        await runJaneAgent(userId, { client, now, trigger: "open" });
        // The dock as it shows (src/lib/jane-agent/popup-stack.ts): re-checked, said as of today.
        const cards = await loadPopupStack(userId, { client, now: opened(now) });
        const { allowedCents } = await loadFacts(userId, { client, now });
        const unsupported = cards.flatMap((c) =>
          unsupportedFigures(c.body, allowedCents).map((f) => `${f} in "${c.body.slice(0, 120)}"`),
        );
        expect(unsupported, `day ${n}`).toEqual([]);
        shown += cards.length;
      }
      expect(shown).toBeGreaterThan(0);
    },
  );

  it.each(PEOPLE)(
    "$id: the lookups' figures are the data's",
    { timeout: 240_000 },
    async (person) => {
      const userId = made.get(person.id)!;
      const now = NOW;
      const tool: Tool = async (name, input = {}) =>
        JSON.parse((await runChatTool(userId, name, input, { client, now })).content);
      const searched = async (merchant: string, from: string, to?: string) =>
        (
          (await tool("search_transactions", { merchant, from, ...(to ? { to } : {}) })) as {
            transactions: { date: string; amount: string; direction: string }[];
          }
        ).transactions;

      // Each subscription's last charge, on its day.
      const { charges } = (await tool("subscriptions")) as {
        charges: { merchant: string; lastCharge: string; lastDate: string }[];
      };
      for (const c of charges) {
        const found = await searched(c.merchant, c.lastDate, c.lastDate);
        expect(
          found.map((t) => t.amount),
          `${c.merchant} on ${c.lastDate}`,
        ).toContain(c.lastCharge);
      }

      // Each return window and renewal from a purchase, at its amount.
      const { items } = (await tool("coming_up")) as {
        items: { what: string; kind: string; amount: string | null }[];
      };
      const year = addDays(now.toISOString().slice(0, 10), -400);
      for (const item of items) {
        const merchant =
          /^Return window for (.+)$/.exec(item.what)?.[1] ?? /^(.+) renews$/.exec(item.what)?.[1];
        if (item.kind !== "deadline" || !merchant || item.amount === null) continue;
        const found = await searched(merchant, year);
        expect(
          found.map((t) => t.amount),
          item.what,
        ).toContain(item.amount);
      }

      // The checking balance is what the accounts hold.
      const safe = (await tool("safe_to_spend")) as { checkingBalance?: string };
      const checking = await client.account.findMany({
        where: { userId, type: "depository", subtype: { in: [...FORECAST_SUBTYPES] } },
        select: { currentBalanceCents: true },
      });
      if (safe.checkingBalance !== undefined) {
        const total = checking.reduce((s, a) => s + (a.currentBalanceCents ?? 0), 0);
        expect(safe.checkingBalance).toBe(
          total < 0 ? `-${formatCents(-total)}` : formatCents(total),
        );
      }
    },
  );
});
