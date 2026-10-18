import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient, type Prisma } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));

import { findingOfType } from "./__fixtures__/findings";
import { runJob } from "./jobs";
import { LinkError, createPlanLink, takeBackLink, useLink, viewPlanLink } from "./plan-links";
import { saveRules, applyStandingRules } from "./standing-rules";

// Runs against a real, migrated Postgres (see src/detection/engine.integration.test.ts).
const url = process.env.TEST_DATABASE_URL;
const HOUR = 60 * 60 * 1000;

describe.runIf(url)("one-tap links against a real database", () => {
  let client: PrismaClient;
  const created: string[] = [];

  async function person() {
    const user = await client.user.create({
      data: { email: `link-${crypto.randomUUID()}@example.com` },
    });
    created.push(user.id);
    for (const type of [
      "bank_fees",
      "duplicate_charge",
      "bill_negotiation",
      "idle_cash",
      "subscription_review",
    ] as const) {
      const f = findingOfType(type);
      await client.finding.create({
        data: {
          userId: user.id,
          type: f.type,
          key: `${f.key}-${crypto.randomUUID()}`,
          title: f.title,
          annualSavingsCents: f.annualSavingsCents,
          amountCents: f.amountCents,
          confidence: f.confidence,
          evidence: f.evidence as Prisma.InputJsonObject,
        },
      });
    }
    return user.id;
  }
  const tokenOf = (url: string) => new URL(url).searchParams.get("token")!;

  beforeAll(() => {
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  });
  afterAll(async () => {
    await client.user.deleteMany({ where: { id: { in: created } } });
    await client.$disconnect();
  });

  it("covers only no-risk items, and stores a hash, not the token", async () => {
    const userId = await person();
    const link = await createPlanLink(userId, { client });
    expect(link?.count).toBe(2);
    const view = await viewPlanLink(tokenOf(link!.url), { client });
    expect(view.state).toBe("ready");
    const titles = view.state === "ready" ? view.items.map((i) => i.title) : [];
    // The fee refund and the double charge; never the call, the cash move or a cancellation.
    expect(titles).toHaveLength(2);
    const row = await client.planLink.findFirstOrThrow({ where: { userId } });
    expect(row.tokenHash).not.toBe(tokenOf(link!.url));
  });

  it("works once, approves each item, waits an hour before starting, and can be taken back", async () => {
    const userId = await person();
    const token = tokenOf((await createPlanLink(userId, { client }))!.url);
    const { approved } = await useLink(token, { client });
    expect(approved).toBe(2);
    await expect(useLink(token, { client })).rejects.toBeInstanceOf(LinkError);

    const decisions = await client.decision.findMany({
      where: { userId },
      include: { action: true },
    });
    expect(decisions.every((d) => d.source === "link")).toBe(true);
    // The agent waits out the hour to take it back.
    const job = await client.job.findFirstOrThrow({
      where: { kind: "agent_step", payload: { path: ["userId"], equals: userId } },
    });
    expect(job.runAt.getTime()).toBeGreaterThan(Date.now() + 0.9 * HOUR);
    expect(await runJob(job.id, { client })).toBe("not_due");

    expect(await viewPlanLink(token, { client })).toMatchObject({
      state: "used",
      canTakeBack: true,
    });
    expect(await takeBackLink(token, { client })).toBe(2);
    expect(await viewPlanLink(token, { client })).toMatchObject({
      state: "used",
      approved: 0,
      canTakeBack: false,
    });
    expect(await client.action.count({ where: { userId } })).toBe(0);
  });

  it("refuses expired, unknown and malformed links", async () => {
    const userId = await person();
    const token = tokenOf((await createPlanLink(userId, { client }))!.url);
    const later = new Date(Date.now() + 8 * 24 * HOUR);
    expect((await viewPlanLink(token, { client, now: later })).state).toBe("expired");
    await expect(useLink(token, { client, now: later })).rejects.toBeInstanceOf(LinkError);
    expect((await viewPlanLink("A".repeat(43), { client })).state).toBe("invalid");
    expect((await viewPlanLink("../../etc", { client })).state).toBe("invalid");
  });

  it("holds work a standing rule approved for a day, so it can be taken back", async () => {
    const userId = await person();
    await saveRules(
      userId,
      [{ key: "recover_bank_fees", enabled: true, monthlyLimit: 3, maxAnnualCents: null }],
      {
        client,
      },
    );
    await applyStandingRules(userId, { client });
    const job = await client.job.findFirstOrThrow({
      where: { kind: "agent_step", payload: { path: ["userId"], equals: userId } },
    });
    expect(job.runAt.getTime()).toBeGreaterThan(Date.now() + 23 * HOUR);
  });
});
