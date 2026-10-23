import { randomBytes } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import type { PlaidApi } from "plaid";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));

import { runChatTool } from "@/lib/jane-agent/claude-tools";
import { borrowingPowerSource } from "@/lib/jane-agent/sources/borrowing-power";
import { loadSnapshot } from "@/lib/jane-agent/snapshot";
import { sendToJane } from "@/lib/jane-agent/typing";
import { demoLender } from "@/lib/lenders/demo";
import { linkDemoBank } from "@/lib/plaid/demo";
import { syncItem } from "@/lib/plaid/sync";
import {
  checkBorrowing,
  ensureBorrowingChecked,
  loadBorrowingPower,
  refreshBorrowing,
} from "./borrowing-power";

// Spec step 250 against a real, migrated Postgres, on Sam's demo bank (a freelancer who rents):
// what a mortgage, a car loan, a personal loan and a card would likely be, from soft checks
// only, each with the day it was checked, kept current monthly, and said when it gets better.

const url = process.env.TEST_DATABASE_URL;
const NOW = new Date("2026-10-18T15:00:00Z");
const DAY = 86_400_000;
const context = { now: NOW, local: { date: "2026-10-18", hour: 8 }, trigger: "open" as const };

describe.runIf(url)("what you could borrow against a real database", { timeout: 60_000 }, () => {
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
  const opts = (now = NOW) => ({ client, now });
  // Spies made in each test: the config restores mocks after every test.
  const spies = () => ({
    apply: vi.spyOn(demoLender, "apply"),
    prequalify: vi.spyOn(demoLender, "prequalify"),
  });

  beforeAll(async () => {
    vi.stubEnv("TOKEN_ENCRYPTION_KEY", randomBytes(32).toString("base64"));
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    vi.stubEnv("PLAID_CLIENT_ID", "");
    vi.stubEnv("PLAID_SECRET", "");
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
    const user = await client.user.create({
      data: { email: `borrow-${crypto.randomUUID()}@example.com` },
    });
    userId = user.id;
    created.push(userId);
    const { itemId } = await linkDemoBank(userId, { client, now: NOW, person: "freelancer" });
    await syncItem(itemId, { client, api: plaid, now: NOW });
  }, 120_000);
  afterAll(async () => {
    await client.user.deleteMany({ where: { id: { in: created } } });
    await client.$disconnect();
    vi.unstubAllEnvs();
  });

  it("is soft-checked by Jane's first run after linking, dated, and never applies", async () => {
    // Linking ran Jane's first look: the score pull, then this check, priced by that score.
    expect(await ensureBorrowingChecked(userId, opts())).toBe(false);
    const d = await loadBorrowingPower(userId, opts());
    expect(d).toMatchObject({ available: true, checkedOn: "2026-10-18", scoreOn: "2026-10-18" });
    expect(d.score).toBeGreaterThan(300);
    expect(d.figures.map((f) => f.product)).toEqual(["mortgage", "auto", "personal", "card"]);
    const mortgage = d.figures[0];
    expect(mortgage.available).toBe(true);
    if (mortgage.product !== "card") {
      expect(mortgage.amountCents).toBeGreaterThan(10_000_000);
      expect(mortgage.amountCents % 100_000).toBe(0);
      expect(mortgage.lender).toBeTruthy();
    }
    // "Check again" asks the partner for soft quotes only.
    const { apply, prequalify } = spies();
    await checkBorrowing(userId, opts());
    expect(prequalify).toHaveBeenCalled();
    expect(apply).not.toHaveBeenCalled();
  });

  it("checks again a month on, not before, and says what got better", async () => {
    const { apply } = spies();
    expect(await refreshBorrowing(userId, opts(new Date(NOW.getTime() + 10 * DAY)))).toBe(false);
    // Make the last check look dearer, as if rates fell since.
    const row = await client.borrowingCheck.findUniqueOrThrow({ where: { userId } });
    const dearer = (row.figures as { aprBps: number | null }[]).map((f) => ({
      ...f,
      aprBps: f.aprBps === null ? null : f.aprBps + 100,
    }));
    await client.borrowingCheck.update({ where: { userId }, data: { figures: dearer } });
    const month = new Date(NOW.getTime() + 31 * DAY);
    expect(await refreshBorrowing(userId, opts(month))).toBe(true);
    const d = await loadBorrowingPower(userId, opts(month));
    expect(d.checkedOn).toBe("2026-11-18");
    expect(d.changes[0]).toMatch(
      /^The likely rate on a mortgage is down to [\d.]+%, from [\d.]+%\.$/,
    );
    const snapshot = (await loadSnapshot(userId, opts(month)))!;
    const [said] = borrowingPowerSource.gather(snapshot, { ...context, now: month });
    expect(said.body).toContain("Good news from this month's soft check");
    expect(said.actions.map((a) => a.id)).toContain("open");
    expect(apply).not.toHaveBeenCalled();
  });

  it("answers in the chat and gives Claude the same figures with their dates", async () => {
    const { reply } = await sendToJane(userId, "what could I borrow?", opts());
    expect(reply.body).toMatch(/^Here's what you could likely get, from soft checks on /);
    expect(reply.body).toContain("A mortgage: up to about $");
    expect(reply.body).toMatch(/Priced by your score of \d+ from Oct 18, 2026\./);
    const tool = JSON.parse((await runChatTool(userId, "borrowing_power", {}, opts())).content);
    expect(tool.softChecksOnly).toBe(true);
    expect(tool.figures[0]).toMatchObject({ product: "mortgage", checkedOn: tool.checkedOn });
  });

  it("checks nothing for someone without a demo bank", async () => {
    const other = await client.user.create({
      data: { email: `borrow-none-${crypto.randomUUID()}@example.com` },
    });
    created.push(other.id);
    expect(await checkBorrowing(other.id, opts())).toBeNull();
    expect((await loadBorrowingPower(other.id, opts())).available).toBe(false);
  });
});
