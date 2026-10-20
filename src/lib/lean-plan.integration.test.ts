import { randomBytes } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import type { PlaidApi } from "plaid";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));

import { takeChatAction } from "@/lib/jane-agent/actions";
import { gather } from "@/lib/jane-agent/brain";
import { postMessages } from "@/lib/jane-agent/messages";
import { loadSnapshot } from "@/lib/jane-agent/snapshot";
import { leanSource } from "@/lib/jane-agent/sources/lean";
import { runPaycheckPlan } from "@/lib/money-movement/paycheck";
import { linkDemoBank } from "@/lib/plaid/demo";
import { syncItem } from "@/lib/plaid/sync";
import { leanActive, loadLeanPlan, openLean, runLeanCheck } from "./lean-plan";

// Spec step 204 against a real, migrated Postgres, with the demo bank: a paycheck late only
// inside its window asks nothing; one that's really late gets one question; a yes pauses
// automatic transfers and gives the plan; pay coming back ends it.

const url = process.env.TEST_DATABASE_URL;
const LINKED = new Date("2026-10-16T15:00:00Z");
const INSIDE_WINDOW = new Date("2026-10-17T15:00:00Z");
const LATE = new Date("2026-10-21T15:00:00Z");
const BACK = new Date("2026-10-23T15:00:00Z");

describe.runIf(url)("when income stops", { timeout: 120_000 }, () => {
  let client: PrismaClient;
  let userId: string;
  let payroll: {
    accountId: string;
    description: string;
    amountCents: number;
    pfcPrimary: string | null;
    pfcDetailed: string | null;
  };
  const created: string[] = [];
  const api = new Proxy(
    {},
    {
      get: () => () => {
        throw new Error("no Plaid");
      },
    },
  ) as PlaidApi;

  beforeAll(async () => {
    vi.stubEnv("TOKEN_ENCRYPTION_KEY", randomBytes(32).toString("base64"));
    vi.stubEnv("AUTH_SECRET", "test-secret-for-unsubscribe-links");
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    vi.stubEnv("PLAID_CLIENT_ID", "");
    vi.stubEnv("PLAID_SECRET", "");
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
    const user = await client.user.create({
      data: { email: `lean-${crypto.randomUUID()}@example.com`, state: "CA" },
    });
    userId = user.id;
    created.push(userId);
    const { itemId } = await linkDemoBank(userId, { client, now: LINKED });
    await syncItem(itemId, { client, api, now: LINKED });
    // The mid-October paycheck never came.
    const gone = await client.transaction.findMany({
      where: { userId, pfcPrimary: "INCOME", date: { gte: new Date("2026-10-15T00:00:00Z") } },
    });
    payroll = gone[0];
    await client.transaction.deleteMany({ where: { id: { in: gone.map((t) => t.id) } } });
    await client.leanPlan.deleteMany({ where: { userId } });
  }, 120_000);
  afterAll(async () => {
    await client.user.deleteMany({ where: { id: { in: created } } });
    await client.$disconnect();
    vi.unstubAllEnvs();
  });

  it("asks nothing inside the window, one question once it's really late", async () => {
    expect(await runLeanCheck(userId, { client, now: INSIDE_WINDOW })).toEqual({
      proposed: 0,
      ended: 0,
    });
    expect(await runLeanCheck(userId, { client, now: LATE })).toEqual({ proposed: 1, ended: 0 });
    expect(await runLeanCheck(userId, { client, now: LATE })).toEqual({ proposed: 0, ended: 0 });
    expect(await openLean(userId, { client })).toEqual([
      expect.objectContaining({ status: "proposed" }),
    ]);
    expect(await leanActive(userId, { client })).toBe(false);
  });

  it("a yes pauses automatic transfers and gives the plan; pay back ends it", async () => {
    const snapshot = (await loadSnapshot(userId, { client, now: LATE }))!;
    await postMessages(userId, gather(snapshot, LATE, { trigger: "open", sources: [leanSource] }), {
      client,
      now: LATE,
    });
    const asked = await client.janeMessage.findFirstOrThrow({
      where: { userId, dedupeKey: { startsWith: "lean:ask:" } },
    });
    expect(asked.body).toMatch(/^Your paycheck from .+ hasn't come in; it was due 2026-10-/);
    const { message } = await takeChatAction(userId, asked.id, "lean.start", { client, now: LATE });
    expect(message.body).toMatch(/^Lean plan on: automatic transfers are paused/);
    expect(message.body).toContain("Your cash covers about");
    expect(message.body).toContain("California unemployment insurance");
    expect(await leanActive(userId, { client })).toBe(true);
    // Paused: no paycheck plan is made while it's in force.
    expect(await runPaycheckPlan(userId, { client, now: LATE })).toBeNull();
    const plan = await loadLeanPlan(userId, { client, now: LATE });
    expect(plan.plan.hardship.length).toBeGreaterThan(0);

    // Pay comes back.
    await client.transaction.create({
      data: {
        userId,
        accountId: payroll.accountId,
        source: "csv",
        date: new Date("2026-10-22T00:00:00Z"),
        amountCents: payroll.amountCents,
        description: payroll.description,
        pfcPrimary: payroll.pfcPrimary,
        pfcDetailed: payroll.pfcDetailed,
      },
    });
    expect(await runLeanCheck(userId, { client, now: BACK })).toEqual({ proposed: 0, ended: 1 });
    expect(await leanActive(userId, { client })).toBe(false);
    const after = (await loadSnapshot(userId, { client, now: BACK }))!;
    const said = gather(after, BACK, { trigger: "open", sources: [leanSource] });
    expect(said.map((m) => m.body)).toEqual([
      expect.stringMatching(/is back, so I'm back to normal/),
    ]);
  });
});
