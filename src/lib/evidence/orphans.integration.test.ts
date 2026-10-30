import { randomBytes } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import type { PlaidApi } from "plaid";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));
// An upload's removal queues the background job; here its detection is run directly.
vi.mock("@/lib/jobs", () => ({ enqueueJob: vi.fn(async () => "job") }));
// Read-only mode leaves real accounts alone; these people's yeses make actions, as the demo
// bank's do (CONCIERGE_ACTIONS.demo).
vi.mock("@/lib/concierge-mode", () => ({ conciergeMode: vi.fn(async () => true) }));

import { runDetection } from "@/detection/engine";
import { CARD_SELECT, buildCard, cardHash } from "@/lib/cards";
import { recordDecision } from "@/lib/decisions";
import { scopedFor } from "@/lib/db-scoped";
import { startOver } from "@/lib/import/remove";
import { runChatTool } from "@/lib/jane-agent/claude-tools";
import { linkDemoBank } from "@/lib/plaid/demo";
import { removePlaidItem } from "@/lib/plaid/remove";
import { syncItem } from "@/lib/plaid/sync";
import { SAMPLE_WIN_KEY } from "@/lib/sample-wins";
import { verifiedSavings } from "@/lib/savings-proof";
import { forgetSince, removeAllOrphans } from "./orphans";

// Derived data never outlives its evidence, against a real, migrated Postgres. The founder asked
// "how much money did Jane save me" and the chat listed the demo bank's Comcast, Verizon and
// Planet Fitness as estimates: actions approved while the demo bank was linked outlived the
// disconnect. After a bank is disconnected, or an upload removed, every surface and chat lookup
// says nothing from it, and the savings answer is $0 with no estimates. Another person's rows
// never come into it.

const url = process.env.TEST_DATABASE_URL;
const NOW = new Date("2026-10-18T15:00:00Z");
const DEMO = /Comcast|Verizon|Planet Fitness|Hulu|Netflix/;
// The lookups the founder's question reaches, and the ones that read findings and savings.
const LOOKUPS = ["proven_savings", "open_findings", "priorities", "monthly_report", "month_close"];

describe.runIf(url)("derived data never outlives its evidence", { timeout: 240_000 }, () => {
  let client: PrismaClient;
  const made: string[] = [];
  const plaid = new Proxy(
    {},
    {
      get: () => () => {
        throw new Error("The demo bank must never call Plaid");
      },
    },
  ) as PlaidApi;

  async function person() {
    const user = await client.user.create({
      data: { email: `orphans-${crypto.randomUUID()}@example.com` },
    });
    made.push(user.id);
    return user.id;
  }

  // Says yes to every finding (each starts an action), and marks the actions done.
  async function approveAll(userId: string) {
    const findings = await client.finding.findMany({ where: { userId }, select: CARD_SELECT });
    for (const finding of findings) {
      await recordDecision(
        userId,
        { findingId: finding.id, choice: "yes", cardHash: cardHash(buildCard(finding)) },
        { client, now: NOW },
      ).catch(() => null);
    }
    await client.action.updateMany({
      where: { userId },
      data: { status: "done", completedAt: NOW },
    });
    return findings.length;
  }

  const said = async (userId: string) =>
    Promise.all(
      LOOKUPS.map(
        async (name) => (await runChatTool(userId, name, {}, { client, now: NOW })).content,
      ),
    );

  beforeAll(() => {
    vi.stubEnv("TOKEN_ENCRYPTION_KEY", randomBytes(32).toString("base64"));
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    vi.stubEnv("PLAID_CLIENT_ID", "");
    vi.stubEnv("PLAID_SECRET", "");
    vi.stubEnv("DEMO_BANK", "1");
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  });
  afterAll(async () => {
    await client.user.deleteMany({ where: { id: { in: made } } });
    await client.$disconnect();
    vi.unstubAllEnvs();
  });

  it("after the demo bank is disconnected, the savings are $0 and nothing from it is said", async () => {
    const userId = await person();
    const { itemId } = await linkDemoBank(userId, { client, now: NOW });
    await syncItem(itemId, { client, api: plaid, now: NOW });
    expect(await approveAll(userId)).toBeGreaterThan(0);
    const before = await verifiedSavings(userId, { client, now: NOW });
    expect(before.actions.estimated.length + before.actions.confirmed.length).toBeGreaterThan(0);
    expect((await said(userId)).join("\n")).toMatch(DEMO);

    // Someone else, with nothing linked, never sees these rows (scopedFor and RLS): stale data
    // of the person's own, never another person's.
    const other = await person();
    expect(await scopedFor(other, client).actions.count()).toBe(0);
    expect(await scopedFor(other, client).findings.count()).toBe(0);
    const theirs = await verifiedSavings(other, { client, now: NOW });
    expect(theirs.expectedCents + theirs.confirmedCents).toBe(0);
    expect((await said(other)).join("\n")).not.toMatch(DEMO);

    await removePlaidItem(userId, itemId, "user_disconnected", { client, api: plaid });

    // Everything built from it went with it: findings, decisions, actions.
    expect(await client.finding.count({ where: { userId } })).toBe(0);
    expect(await client.decision.count({ where: { userId } })).toBe(0);
    expect(await client.action.count({ where: { userId } })).toBe(0);
    const after = await verifiedSavings(userId, { client, now: NOW });
    expect(after.confirmedCents).toBe(0);
    expect(after.expectedCents).toBe(0);
    expect(after.actions.estimated).toEqual([]);
    const proven = JSON.parse(
      (await runChatTool(userId, "proven_savings", {}, { client, now: NOW })).content,
    );
    expect(JSON.stringify(proven)).not.toMatch(/\$[1-9]/);
    expect((await said(userId)).join("\n")).not.toMatch(DEMO);
  });

  it("a sample person's past wins go with their demo bank", async () => {
    const userId = await person();
    const { itemId } = await linkDemoBank(userId, { client, now: NOW, person: "renter" });
    await syncItem(itemId, { client, api: plaid, now: NOW });
    const wins = () =>
      client.finding.count({ where: { userId, key: { startsWith: SAMPLE_WIN_KEY } } });
    expect(await wins()).toBeGreaterThan(0);
    expect((await verifiedSavings(userId, { client, now: NOW })).confirmedCents).toBeGreaterThan(0);
    await removePlaidItem(userId, itemId, "user_disconnected", { client, api: plaid });
    expect(await wins()).toBe(0);
    const after = await verifiedSavings(userId, { client, now: NOW });
    expect(after.confirmedCents + after.expectedCents).toBe(0);
  });

  it("after an upload is removed, its findings and the actions on them go", async () => {
    const userId = await person();
    const account = await client.account.create({
      data: { userId, source: "csv", name: "Checking", type: "depository", subtype: "checking" },
    });
    // Eight months of a Comcast bill above the typical price, and a paycheck.
    const months = Array.from({ length: 8 }, (_, i) =>
      new Date(Date.UTC(2026, 1 + i, 12)).toISOString().slice(0, 10),
    );
    await client.transaction.createMany({
      data: months.flatMap((date) => [
        {
          userId,
          accountId: account.id,
          source: "csv" as const,
          date: new Date(`${date}T00:00:00Z`),
          amountCents: 16_500,
          description: "COMCAST XFINITY",
          merchantName: "Comcast",
          pfcPrimary: "RENT_AND_UTILITIES",
          pfcDetailed: "RENT_AND_UTILITIES_INTERNET_AND_CABLE",
        },
        {
          userId,
          accountId: account.id,
          source: "csv" as const,
          date: new Date(`${date}T00:00:00Z`),
          amountCents: -300_000,
          description: "ACME PAYROLL",
          merchantName: null,
          pfcPrimary: "INCOME",
          pfcDetailed: "INCOME_WAGES",
        },
      ]),
    });
    await runDetection(userId, { client, now: NOW, checkSubscriptions: async () => new Map() });
    expect(await approveAll(userId)).toBeGreaterThan(0);
    expect((await verifiedSavings(userId, { client, now: NOW })).expectedCents).toBeGreaterThan(0);

    // What the night debugger saw left after Start over (made-up rows of each kind).
    await client.planProposal.create({
      data: {
        userId,
        key: "budget:Food and drink",
        kind: "budget",
        payload: { amountCents: 50_000 },
      },
    });
    const fact = (key: string, source: string) => ({
      userId,
      key,
      value: "x",
      label: key,
      source,
      confidence: 80,
      firstSeen: NOW,
      lastConfirmed: NOW,
    });
    await client.userFact.createMany({
      data: [fact("rent_payee", "upload"), fact("prefers_diy", "chat")],
    });
    await client.insurancePolicy.create({
      data: { userId, kind: "auto", carrier: "Geico", source: "payments", status: "found" },
    });
    await client.alert.create({
      data: { userId, type: "low_balance", key: "low:1", title: "Low balance", body: "." },
    });
    await client.janeMessage.create({
      data: {
        userId,
        kind: "decision",
        body: "I could set a $500.00 monthly budget for Food and drink.",
        actions: [{ id: "proposal.yes", label: "Yes", kind: "primary" }],
        dedupeKey: "proposals:budget:Food and drink",
      },
    });

    await startOver(scopedFor(userId, client));
    // The gate drops them at once, before the background job's detection cleans up.
    expect((await verifiedSavings(userId, { client, now: NOW })).expectedCents).toBe(0);
    expect((await said(userId)).join("\n")).not.toMatch(/Comcast/);
    await runDetection(userId, { client, now: NOW, checkSubscriptions: async () => new Map() });
    expect(await client.action.count({ where: { userId } })).toBe(0);
    expect(await client.finding.count({ where: { userId } })).toBe(0);
    // Nothing of the data is left, so nothing worked out from it is either.
    expect(await client.planProposal.count({ where: { userId } })).toBe(0);
    expect(await client.alert.count({ where: { userId } })).toBe(0);
    expect(await client.insurancePolicy.count({ where: { userId } })).toBe(0);
    expect(await client.janeMessage.count({ where: { userId, status: "open" } })).toBe(0);
    // What was read from the statements goes; what the person said or did stays.
    const facts = await client.userFact.findMany({
      where: { userId },
      select: { key: true, source: true },
    });
    expect(facts.filter((f) => f.source === "upload" || f.source === "detector")).toEqual([]);
    expect(facts.map((f) => f.key)).toContain("prefers_diy");
  });

  it("cleans up rows orphaned before this existed, every night, and is idempotent", async () => {
    const userId = await person();
    const account = await client.account.create({
      data: { userId, source: "csv", name: "Checking", type: "depository", subtype: "checking" },
    });
    // A finding naming an account that is gone, and one naming the account that is left.
    await client.finding.createMany({
      data: [
        {
          userId,
          type: "bill_negotiation",
          key: "gone",
          title: "Your Comcast internet and TV bill is above the typical price",
          annualSavingsCents: 54_000,
          amountCents: 16_500,
          confidence: "medium",
          evidence: { accountId: "acct-from-a-disconnected-bank" },
        },
        {
          userId,
          type: "idle_cash",
          key: "kept",
          title: "Move idle cash",
          annualSavingsCents: 10_000,
          amountCents: 0,
          confidence: "medium",
          evidence: { accountId: account.id },
        },
      ],
    });
    const first = await removeAllOrphans({ client, userIds: [userId] });
    expect(first.removed.findings).toBe(1);
    expect(
      (await client.finding.findMany({ where: { userId }, select: { key: true } })).map(
        (f) => f.key,
      ),
    ).toEqual(["kept"]);
    expect((await removeAllOrphans({ client, userIds: [userId] })).removed.findings).toBe(0);
  });

  it("forgets the demo bank's stand-ins made while it was linked, and never a real bank's", async () => {
    // Night debugger, round 6: after the demo bank went, its credit pull, rate and borrowing
    // checks and insurance checkup stayed.
    const standIns = async (userId: string) => {
      await client.creditReport.create({
        data: {
          userId,
          partner: "stand-in",
          score: 712,
          model: "VantageScore 3.0",
          rangeLow: 300,
          rangeHigh: 850,
          cardLimitCents: 500_000,
          averageAgeMonths: 40,
          hardInquiries: 1,
          pulledOn: new Date(),
        },
      });
      await client.borrowingCheck.create({
        data: { userId, checkedOn: new Date(), partner: "stand-in" },
      });
      await client.refinanceCheck.create({
        data: { userId, checkedOn: new Date(), partner: "stand-in" },
      });
      await client.insuranceCheckup.create({ data: { userId, reason: "asked" } });
    };
    const count = async (userId: string) =>
      (await client.creditReport.count({ where: { userId } })) +
      (await client.borrowingCheck.count({ where: { userId } })) +
      (await client.refinanceCheck.count({ where: { userId } })) +
      (await client.insuranceCheckup.count({ where: { userId } }));
    const linked = new Date(Date.now() - 60_000);
    const demo = await person();
    const real = await person();
    await standIns(demo);
    await standIns(real);
    await forgetSince(scopedFor(demo, client), linked, "bank", { demo: true });
    await forgetSince(scopedFor(real, client), linked, "bank", { demo: false });
    expect(await count(demo)).toBe(0);
    expect(await count(real)).toBe(4);
  });
});
