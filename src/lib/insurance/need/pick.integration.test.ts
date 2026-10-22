import { randomBytes } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.hoisted(() => {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? "";
});
vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));

import { createCheckPerson, deleteCheckPerson } from "@/lib/jane-agent/checks/person";
import { optionsForNeed } from "./load";
import { PickError, pickOption, type CoverPickOptions } from "./pick";

// Picking an option queues it for the concierge (spec step 276), against a real, migrated
// Postgres: a finding, a decision with the chosen option and whether it adds missing cover or
// replaces a policy, and a queued action. Once only, and only in demo advice mode.

const url = process.env.TEST_DATABASE_URL;
const NOW = new Date("2026-10-18T15:00:00Z");

describe.runIf(url)("picking an option, against a real database", () => {
  let client: PrismaClient;
  let me = "";
  const strangers: string[] = [];

  beforeAll(async () => {
    vi.stubEnv("TOKEN_ENCRYPTION_KEY", randomBytes(32).toString("base64"));
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
    me = await createCheckPerson({ client, now: NOW });
  }, 120_000);
  afterAll(async () => {
    await deleteCheckPerson(me, { client });
    await client.user.deleteMany({ where: { id: { in: strangers } } });
    await client.$disconnect();
  });

  it("queues the pick: a finding, a decision with the option, and an action", async () => {
    const found = await optionsForNeed(me, "auto_liability", { client, now: NOW });
    expect(found?.set.options.length).toBeGreaterThanOrEqual(2);
    const pick = found!.set.options.find((o) => o.isPick)!;
    const result = await pickOption(me, "auto_liability", pick.id, { client, now: NOW });
    expect(result.newCover).toBe(false);

    const decision = await client.decision.findUniqueOrThrow({ where: { id: result.decisionId } });
    const kept = (decision.options as unknown as CoverPickOptions).coverPick;
    expect(kept).toMatchObject({
      need: "auto_liability",
      optionId: pick.id,
      carrier: pick.carrier,
      annualPremiumCents: pick.annualPremiumCents,
      newCover: false,
    });
    expect(kept.policyId).not.toBeNull();
    const action = await client.action.findUniqueOrThrow({ where: { id: result.actionId } });
    expect(action).toMatchObject({
      type: "insurance_reshop",
      status: "queued",
      decisionId: decision.id,
    });
  });

  it("never queues the same pick twice", async () => {
    const found = await optionsForNeed(me, "auto_liability", { client, now: NOW });
    const option = found!.set.options[0];
    await expect(pickOption(me, "auto_liability", option.id, { client, now: NOW })).rejects.toThrow(
      /already picked/,
    );
    expect(await client.action.count({ where: { userId: me, type: "insurance_reshop" } })).toBe(1);
  });

  it("refuses an option that isn't offered, and a real account", async () => {
    await expect(pickOption(me, "disability", "nope", { client, now: NOW })).rejects.toBeInstanceOf(
      PickError,
    );
    const stranger = await client.user.create({
      data: { email: `ins-pick-${crypto.randomUUID()}@example.com` },
    });
    strangers.push(stranger.id);
    await expect(
      pickOption(stranger.id, "auto_liability", "need", { client, now: NOW }),
    ).rejects.toThrow(/demo mode/);
  });
});
