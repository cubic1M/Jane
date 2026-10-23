import { randomBytes } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import type { PlaidApi } from "plaid";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));

import { REFI_MIN_SAVING_CENTS } from "@/config/debt";
import { gather } from "@/lib/jane-agent/brain";
import { runChatTool } from "@/lib/jane-agent/claude-tools";
import { runJaneAgent } from "@/lib/jane-agent/run";
import { loadSnapshot } from "@/lib/jane-agent/snapshot";
import { sendToJane } from "@/lib/jane-agent/typing";
import { linkDemoBank } from "@/lib/plaid/demo";
import { syncItem } from "@/lib/plaid/sync";
import {
  checkRates,
  ensureChecked,
  lenderPartnerFor,
  loadRefinance,
  refreshRefinance,
} from "./refinance";

// Spec step 111 against a real, migrated Postgres, on the demo bank: Jane asks the
// stand-in lender partner for offers once a month by herself, compares each with keeping
// the debt over the same months (fees in), picks one only when it saves enough, says so
// once per offer in the chat, and never applies for anything. A real account gets no
// offers at all.

const url = process.env.TEST_DATABASE_URL;
const LINKED = new Date("2026-10-18T15:00:00Z");
const DAY = 24 * 60 * 60 * 1000;
const later = (days: number) => new Date(LINKED.getTime() + days * DAY);

describe.runIf(url)("refinance offers against a real database", () => {
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
  const opts = (now = LINKED) => ({ client, now });

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
    userId = await person("refi-demo");
    const { itemId } = await linkDemoBank(userId, { client, now: LINKED });
    await syncItem(itemId, { client, api: plaid, now: LINKED });
  }, 120_000);
  afterAll(async () => {
    await client.user.deleteMany({ where: { id: { in: created } } });
    await client.$disconnect();
    vi.unstubAllEnvs();
  });

  it("checks rates by herself once a month, and keeps the offers", async () => {
    // Jane's run after the demo bank's first sync already asked.
    expect((await loadRefinance(userId, opts())).checkedOn).toBe("2026-10-18");
    expect(await refreshRefinance(userId, opts())).toBe(false);
    expect(await refreshRefinance(userId, opts(later(10)))).toBe(false);
    const row = await client.refinanceCheck.findUniqueOrThrow({ where: { userId } });
    expect(row.partner).toBe("demo");
    expect(await refreshRefinance(userId, opts(later(31)))).toBe(true);
    // Back to today's offers for the rest of the tests.
    await checkRates(userId, opts());
  });

  it("keeps one check when two pages ask at once", async () => {
    await client.refinanceCheck.deleteMany({ where: { userId } });
    const checks = await Promise.all([1, 2, 3].map(() => checkRates(userId, opts())));
    expect(checks.every((c) => c !== null && c.length > 0)).toBe(true);
    expect(await client.refinanceCheck.count({ where: { userId } })).toBe(1);
  });

  it("compares every loan and card with keeping it, fees in, and picks only real savings", async () => {
    const refi = await loadRefinance(userId, opts());
    expect(refi.available).toBe(true);
    const by = (name: string) => refi.comparisons.find((c) => c.debtName.startsWith(name))!;
    const car = by("Demo Car Loan");
    expect(car.termMonths).toBe(36);
    expect(car.pick?.offer).toMatchObject({ lender: "Harbor Auto Refi", demo: true });
    expect(car.pick!.savingCents).toBeGreaterThanOrEqual(REFI_MIN_SAVING_CENTS);
    for (const s of car.offers) {
      expect(s.savingCents).toBe(car.currentTotalCents - s.totalCents);
    }
    // A fixed rate is picked over the cheaper variable one.
    expect(by("Demo Student Loan").pick?.offer.rateType).toBe("fixed");
    // The card's balance moves to a personal loan.
    expect(by("Demo Credit Card").product).toBe("personal");
    // Nothing beats a 3.99% mortgage: no pick, and the break-even is there for each offer.
    const home = by("Demo Home Loan");
    expect(home.pick).toBeNull();
    expect(home.offers.every((s) => s.savingCents < 0)).toBe(true);
  });

  it("brings up each offer that saves enough once, as labelled demo advice", async () => {
    const snapshot = await loadSnapshot(userId, opts());
    const messages = gather(snapshot!, LINKED, { trigger: "sync" }).filter(
      (m) => m.source === "refinance",
    );
    // The car and student loans; the card isn't offered, because the demo person's spare cash
    // clears it for less than any loan (the fit engine's pick, loans QA).
    expect(messages.length).toBe(2);
    expect(messages.some((m) => m.body.includes("Demo Credit Card"))).toBe(false);
    const car = messages.find((m) => m.body.includes("Demo Car Loan"))!;
    expect(car).toMatchObject({ kind: "decision", refs: { advice: true } });
    expect(car.dedupeKey).toMatch(/^refinance:offer:account:\w+:demo-harbor-\d+-36$/);
    expect(car.body.split("\n")[0]).toMatch(
      /^I checked loan rates for you\. Your Demo Car Loan ····0006 \(6\.90%, \$18,020\.00 left\) could move to Harbor Auto Refi at 5\.\d\d% fixed\.$/,
    );
    expect(car.body).toContain("Nothing is applied for until you say so.");
    expect(car.actions.map((a) => a.label)).toEqual([
      "Apply with Harbor Auto Refi",
      "See the offers",
      "Not now",
    ]);
  });

  it("answers 'can I refinance my car loan?' with the pick, why and the others", async () => {
    const { reply } = await sendToJane(userId, "Can I refinance my car loan?", opts());
    expect(reply.body).toContain("Your Demo Car Loan ····0006: $18,020.00 at 6.90%.");
    expect(reply.body).toMatch(/My pick: Harbor Auto Refi at 5\.\d\d% fixed/);
    expect(reply.body).toContain("Also: ");
    expect(reply.refs).toMatchObject({
      advice: true,
      refinance: { debtKey: expect.stringMatching(/^account:/), lender: "Harbor Auto Refi" },
    });
    expect(reply.actions[0]).toMatchObject({ id: "loan.prepare" });
    const home = await sendToJane(userId, "refinance my mortgage", opts(later(0.001)));
    expect(home.reply.body).toContain("None of the 2 offers beats keeping it");
    expect(home.reply.refs.refinance).toBeUndefined();
    expect(home.reply.refs.advice).toBeUndefined();
  });

  it("gives Claude every offer with its figures recorded, and applies for nothing", async () => {
    const tool = await runChatTool(userId, "refinance_offers", {}, opts());
    const output = JSON.parse(tool.content);
    const car = output.debts.find((d: { debt: string }) => d.debt.startsWith("Demo Car Loan"));
    expect(car.janesPick.lender).toBe("Harbor Auto Refi");
    expect(car.janesPick.sample).toBe(true);
    expect(tool.cents.length).toBeGreaterThan(10);
    expect(await client.action.count({ where: { userId } })).toBe(0);
  });

  it("checks during Jane's own run", async () => {
    await runJaneAgent(userId, { client, now: later(40), trigger: "open" });
    const row = await client.refinanceCheck.findUniqueOrThrow({ where: { userId } });
    expect(row.checkedOn.toISOString().slice(0, 10)).toBe("2026-11-27");
  });

  it("checks when the offers are opened before Jane's first check, and only then", async () => {
    expect(await ensureChecked(userId, opts())).toBe(false);
    await client.refinanceCheck.deleteMany({ where: { userId } });
    expect(await ensureChecked(userId, opts())).toBe(true);
    expect((await loadRefinance(userId, opts())).checkedOn).toBe("2026-10-18");
  });

  it("never pulls anything for a real account", async () => {
    const realId = await person("refi-real");
    await client.account.create({
      data: {
        userId: realId,
        source: "csv",
        name: "Store Card",
        type: "credit",
        subtype: "credit card",
        currentBalanceCents: 120_000,
      },
    });
    expect(await lenderPartnerFor(realId, opts())).toBeNull();
    expect(await checkRates(realId, opts())).toBeNull();
    expect(await ensureChecked(realId, opts())).toBe(false);
    expect(await client.refinanceCheck.count({ where: { userId: realId } })).toBe(0);
    const { reply } = await sendToJane(realId, "find me a better rate", opts());
    expect(reply.body).toMatch(
      /^Refinance offers come from a lending partner, and there isn't one/,
    );
  });
});
