import { randomBytes } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { STANDING_AREAS } from "@/config/agent-rollout";
import { SECTORS } from "@/config/autopilot-sectors";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));

import { mistakeStats, closeMistake, reportMistake, MistakeError } from "@/lib/act-mistakes";
import { logAudit } from "@/lib/audit";
import { throughPermission } from "@/lib/permission/check";
import { linkDemoBank } from "@/lib/plaid/demo";
import { mayAct, sectorAutopilots } from "@/lib/sector-autopilot";
import { rulesFor } from "@/lib/standing-rules";
import { grantArea, revokeArea, standingAreas } from "./standing-permission";

// One tap per area, and what a reported mistake does, against a real Postgres, on the demo bank.

const url = process.env.TEST_DATABASE_URL;
const NOW = new Date("2026-10-18T15:00:00Z");

describe.runIf(url)("one-tap standing permission and mistakes", { timeout: 120_000 }, () => {
  let client: PrismaClient;
  const created: string[] = [];
  const options = () => ({ client, now: NOW });

  beforeAll(() => {
    vi.stubEnv("TOKEN_ENCRYPTION_KEY", randomBytes(32).toString("base64"));
    vi.stubEnv("PLAID_CLIENT_ID", "");
    vi.stubEnv("PLAID_SECRET", "");
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url! }) });
  });
  afterAll(async () => {
    await client.user.deleteMany({ where: { id: { in: created } } });
    await client.$disconnect();
    vi.unstubAllEnvs();
  });

  async function person(demo = true) {
    const user = await client.user.create({
      data: { email: `standing-${crypto.randomUUID()}@example.com` },
    });
    created.push(user.id);
    if (demo) await linkDemoBank(user.id, { client, now: NOW });
    else {
      await client.account.create({
        data: { userId: user.id, source: "csv", name: "Checking", type: "depository" },
      });
    }
    return user.id;
  }

  it("one tap hands over that area only, under its caps, with its rules", async () => {
    const userId = await person();
    expect((await standingAreas(userId, options())).every((a) => !a.on)).toBe(true);
    await grantArea(userId, "bills", options());
    const areas = await standingAreas(userId, options());
    expect(areas.filter((a) => a.on).map((a) => a.sector)).toEqual(["bills"]);
    const settings = await sectorAutopilots(userId, options());
    for (const sector of SECTORS.filter((s) => s !== "bills")) {
      expect(settings.find((s) => s.sector === sector)?.level, sector).toBe("ask");
    }
    const bills = STANDING_AREAS.find((a) => a.sector === "bills")!;
    expect(settings.find((s) => s.sector === "bills")).toMatchObject({
      level: "safe",
      actionCapCents: bills.actionCapCents,
      monthlyCapCents: bills.monthlyCapCents,
    });
    const rules = await rulesFor(userId, { client });
    for (const key of bills.rules)
      expect(rules.find((r) => r.key === key)?.enabled, key).toBe(true);
    expect(rules.find((r) => r.key === "lower_card_interest")?.enabled).toBe(false);
    expect(vi.mocked(logAudit).mock.calls.map((c) => c[1])).toContain(
      "standing_permission_granted",
    );
    expect(await mayAct(userId, "bills", { needs: "safe", cents: 100 }, options())).toMatchObject({
      ok: true,
    });
    expect(await mayAct(userId, "debt", { needs: "safe", cents: 100 }, options())).toMatchObject({
      ok: false,
    });
  });

  it("a tap back turns it off, rules too", async () => {
    const userId = await person();
    await grantArea(userId, "bills", options());
    await revokeArea(userId, "bills", options());
    expect((await standingAreas(userId, options())).some((a) => a.on)).toBe(false);
    expect((await rulesFor(userId, { client })).some((r) => r.enabled)).toBe(false);
  });

  it("keeps what someone who already set a level chose elsewhere", async () => {
    const userId = await person();
    await client.user.update({ where: { id: userId }, data: { autopilot: "safe" } });
    await grantArea(userId, "insurance", options());
    const on = (await standingAreas(userId, options())).filter((a) => a.on).map((a) => a.sector);
    expect(on).toContain("insurance");
    expect(on).toContain("bills");
  });

  it("a real account can't be handed over: exactly as read-only as today", async () => {
    const userId = await person(false);
    await expect(grantArea(userId, "bills", options())).rejects.toMatchObject({
      reason: "read_only",
    });
    expect(await client.autopilotSector.count({ where: { userId } })).toBe(0);
    expect((await client.user.findUniqueOrThrow({ where: { id: userId } })).autopilot).toBeNull();
    expect(await client.standingRule.count({ where: { userId, enabled: true } })).toBe(0);
  });

  async function act(userId: string, sector = "bills") {
    await throughPermission(
      userId,
      {
        specialist: "money_movement",
        what: "Scheduled $25.00 to Chase",
        sector,
        cents: 2_500,
        authority: { kind: "yes" },
        undo: { kind: "none", why: "test" },
      },
      options(),
      async () => undefined,
    );
    return (await client.janeAct.findFirstOrThrow({ where: { userId } })).id;
  }

  it("a reported mistake is kept, stops the area, and closes with what was done", async () => {
    const userId = await person();
    await grantArea(userId, "bills", options());
    const actId = await act(userId);
    await reportMistake(userId, actId, "Wrong company", options());
    const [mistake] = await client.actMistake.findMany({ where: { userId } });
    expect(mistake).toMatchObject({ note: "Wrong company", status: "open", simulated: true });
    expect((await standingAreas(userId, options())).find((a) => a.sector === "bills")?.on).toBe(
      false,
    );
    // Twice is one mistake.
    await reportMistake(userId, actId, "again", options());
    expect(await client.actMistake.count({ where: { userId } })).toBe(1);

    await expect(closeMistake(mistake.id, " ", options())).rejects.toBeInstanceOf(MistakeError);
    await closeMistake(mistake.id, "Wrote to them to correct it", options());
    expect(await client.actMistake.findUniqueOrThrow({ where: { id: mistake.id } })).toMatchObject({
      status: "handled",
      resolution: "Wrote to them to correct it",
    });
    await expect(closeMistake(mistake.id, "again", options())).rejects.toBeInstanceOf(MistakeError);
  });

  it("stops the agent on that action", async () => {
    const userId = await person();
    const finding = await client.finding.create({
      data: {
        userId,
        type: "bank_fees",
        key: `k-${crypto.randomUUID()}`,
        title: "Fees",
        status: "in_progress",
        confidence: "high",
        evidence: {},
      },
    });
    const decision = await client.decision.create({
      data: { userId, findingId: finding.id, choice: "yes", cardSnapshot: {}, source: "card" },
    });
    const action = await client.action.create({
      data: {
        userId,
        decisionId: decision.id,
        type: "recover_bank_fees",
        agentState: "waiting_reply",
        status: "in_progress",
      },
    });
    const actId = await act(userId);
    await client.janeAct.updateMany({ where: { id: actId }, data: { actionId: action.id } });
    await reportMistake(userId, actId, "", options());
    expect(await client.action.findUniqueOrThrow({ where: { id: action.id } })).toMatchObject({
      agentState: "handed_off",
      agentNextAt: null,
    });
  });

  it("won't take a report on someone else's act", async () => {
    const [a, b] = [await person(), await person()];
    const actId = await act(a);
    await expect(reportMistake(b, actId, "", options())).rejects.toBeInstanceOf(MistakeError);
    expect(await client.actMistake.count({ where: { actId } })).toBe(0);
  });

  it("the rate counts real acts apart from the rehearsal's", async () => {
    const userId = await person();
    const before = await mistakeStats({ client });
    const actId = await act(userId);
    await reportMistake(userId, actId, "", options());
    expect(await mistakeStats({ client })).toEqual(before);
    const rehearsal = await mistakeStats({ client, simulated: true });
    expect(rehearsal.mistakes).toBeGreaterThan(0);
    expect(rehearsal.rate).toBeGreaterThan(0);
  });
});
