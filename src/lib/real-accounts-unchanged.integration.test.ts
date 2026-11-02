import { randomBytes } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { REAL_ACCOUNT_ADVICE } from "@/config/advice";
import { REAL_TRADING } from "@/config/brokerage";
import { CONCIERGE_ACTIONS } from "@/config/concierge";
import { promisesHiddenPage } from "@/config/hidden-pages";
import { REAL_MONEY_MOVEMENT } from "@/config/money-movement";
import { PAYMENT_ROLLOUT } from "@/config/money-rollout";
import { SPECIALISTS } from "@/config/specialists";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));

import { conciergeMode } from "./concierge-mode";
import { creditPartnerFor } from "./credit";
import { recordDecision } from "./decisions";
import { filingPartnerFor } from "./filing";
import { partnerFor as insurancePartnerFor } from "./insurance/partner";
import { moneyPartnerFor } from "./money-movement/partner";
import { taxPaymentPartnerFor } from "./tax-payments";
import { donorFundPartnerFor } from "./donor-fund";
import { checkPermission } from "./permission/check";
import { specialistsFor } from "./specialists/registry";
import { grantArea, standingAreas } from "./standing-permission";
import { loadTimeline } from "./timeline";
import { CARD_SELECT, buildCard, cardHash } from "./cards";

// However far the controller's stages are built, a real account behaves as it does today: read-only,
// no partner of any kind, every specialist off, nothing acts. The flags below don't change without
// counsel's sign-off, in the pull request that changes them.

const url = process.env.TEST_DATABASE_URL;
const NOW = new Date("2026-10-18T15:00:00Z");

describe("the flags", () => {
  it("are all off", () => {
    expect(REAL_MONEY_MOVEMENT).toBe(false);
    expect(REAL_ACCOUNT_ADVICE).toBe(false);
    expect(REAL_TRADING).toBe(false);
    expect(CONCIERGE_ACTIONS.realAccounts).toBe(false);
    expect(PAYMENT_ROLLOUT.ownAccounts).toBe(false);
    expect(PAYMENT_ROLLOUT.underCap).toBe(false);
    expect(SPECIALISTS.every((s) => s.kind === "stand_in")).toBe(true);
  });

  it("hidden pages stay hidden", () => {
    expect(promisesHiddenPage({ label: "See it", href: "/transfers" })).toBe(false);
    expect(promisesHiddenPage({ label: "Set up", href: "/transfers" })).toBe(true);
  });
});

describe.runIf(url)("a real account", { timeout: 120_000 }, () => {
  let client: PrismaClient;
  let userId: string;
  const created: string[] = [];

  beforeAll(async () => {
    vi.stubEnv("TOKEN_ENCRYPTION_KEY", randomBytes(32).toString("base64"));
    // Even with every rehearsal on.
    vi.stubEnv("AGENT_REHEARSAL", "1");
    vi.stubEnv("PAYMENT_REHEARSAL", "1");
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url! }) });
    const user = await client.user.create({
      data: { email: `real-${crypto.randomUUID()}@example.com` },
    });
    userId = user.id;
    created.push(user.id);
    await client.account.create({
      data: { userId, source: "csv", name: "Checking", type: "depository" },
    });
  });
  afterAll(async () => {
    await client.user.deleteMany({ where: { id: { in: created } } });
    await client.$disconnect();
    vi.unstubAllEnvs();
  });

  it("isn't acted for, and has no partner of any kind", async () => {
    expect(await conciergeMode(userId, { client })).toBe(false);
    expect(await moneyPartnerFor(userId, { client })).toBeNull();
    expect(await filingPartnerFor(userId, { client })).toBeNull();
    expect(await creditPartnerFor(userId, { client })).toBeNull();
    expect(await insurancePartnerFor(userId, { client })).toBeNull();
    expect(await taxPaymentPartnerFor(userId, { client })).toBeNull();
    expect(await donorFundPartnerFor(userId, { client })).toBeNull();
    expect((await specialistsFor(userId, { client })).some((s) => s.on)).toBe(false);
  });

  it("every specialist is refused by the check, on a yes and on a standing limit", async () => {
    for (const s of SPECIALISTS) {
      for (const authority of [
        { kind: "yes" as const },
        { kind: "standing" as const, sector: s.sector, needs: "safe" as const },
      ]) {
        expect(
          await checkPermission(
            userId,
            {
              specialist: s.key,
              what: "x",
              sector: s.sector,
              cents: 1,
              authority,
              undo: { kind: "none", why: "x" },
            },
            { client, now: NOW },
          ),
          s.key,
        ).toEqual({ ok: false, reason: "read_only" });
      }
    }
  });

  it("can't hand an area over, and has done nothing", async () => {
    await expect(grantArea(userId, "bills", { client, now: NOW })).rejects.toMatchObject({
      reason: "read_only",
    });
    expect((await standingAreas(userId, { client, now: NOW })).some((a) => a.on)).toBe(false);
    expect(await loadTimeline(userId, { client, now: NOW })).toEqual([]);
    expect(await client.janeAct.count({ where: { userId } })).toBe(0);
  });

  it("a Yes on a finding is theirs to do, with the steps, and nothing goes to an agent", async () => {
    const finding = await client.finding.create({
      data: {
        userId,
        type: "subscription_review",
        key: `k-${crypto.randomUUID()}`,
        title: "Review your Hulu subscription",
        amountCents: 1_799,
        annualSavingsCents: 21_588,
        confidence: "high",
        explanation: "You pay for it.",
        evidence: { merchant: "Hulu", frequency: "monthly", lastAmountCents: 1_799 },
      },
    });
    const row = await client.finding.findUniqueOrThrow({
      where: { id: finding.id },
      select: CARD_SELECT,
    });
    const out = await recordDecision(
      userId,
      { findingId: finding.id, choice: "yes", cardHash: cardHash(buildCard(row, null)) },
      { client, now: NOW },
    );
    expect(out).toMatchObject({ diy: true, actionId: null });
    expect(await client.action.count({ where: { userId } })).toBe(0);
    expect(
      await client.job.count({ where: { payload: { path: ["userId"], equals: userId } } }),
    ).toBe(0);
    // On the record, open, with what settles it: Stage 1's whole change here.
    const outcome = await client.suggestionOutcome.findFirstOrThrow({
      where: { userId, suggestionKey: `finding:${finding.id}` },
    });
    expect(outcome.answer).toBe("yes");
    expect(outcome.doneAt).toBeNull();
  });
});
