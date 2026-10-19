import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));

import { SECTOR_DEFAULTS } from "@/config/autopilot-sectors";
import { logAudit } from "@/lib/audit";
import { setAutopilot } from "@/lib/autopilot";
import { insuranceAutopilot } from "@/lib/insurance/autopilot";
import { ensureDemoPolicies } from "@/lib/insurance/profile";
import { reshopPerson } from "@/lib/insurance/shop";
import { takeChatAction } from "@/lib/jane-agent/actions";
import { answerByRules } from "@/lib/jane-agent/answer";
import { runChatTool } from "@/lib/jane-agent/claude-tools";
import { parseIntent } from "@/lib/jane-agent/intents";
import { postMessages } from "@/lib/jane-agent/messages";
import { runPlanUpkeep } from "@/lib/plan-upkeep";
import { applyStandingRules } from "@/lib/standing-rules";
import {
  SectorAutopilotError,
  autopilotFor,
  mayAct,
  recordAct,
  resetSectorAutopilot,
  sectorAutopilots,
  setSectorAutopilot,
} from "./sector-autopilot";

// Spec step 141 against a real, migrated Postgres: one autopilot, every sector. Defaults
// come from the step 57 level; a sector set by the person wins (except "Ask me first");
// no sector acts above its level or caps; changes are audited and take effect at once; the
// bills rules, the goals upkeep and insurance switches all read it; the chat sets it on a tap.

const url = process.env.TEST_DATABASE_URL;
const NOW = new Date("2026-10-19T16:00:00Z");

describe.runIf(url)("one autopilot, every sector", { timeout: 60_000 }, () => {
  let client: PrismaClient;
  const created: string[] = [];

  async function person(prefix: string, autopilot: "ask" | "safe" | "all" | null = "safe") {
    const user = await client.user.create({
      data: { email: `${prefix}-${crypto.randomUUID()}@example.com`, autopilot },
    });
    created.push(user.id);
    await client.account.create({
      data: {
        userId: user.id,
        source: "plaid",
        name: "Checking",
        type: "depository",
        subtype: "checking",
      },
    });
    return user.id;
  }

  beforeAll(() => {
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  });
  afterAll(async () => {
    await client.user.deleteMany({ where: { id: { in: created } } });
    await client.$disconnect();
  });

  it("starts from the step 57 level's defaults, never 'everything allowed'", async () => {
    for (const level of ["ask", "safe", "all"] as const) {
      const userId = await person(`sector-default-${level}`, level);
      const sectors = await sectorAutopilots(userId, { client, now: NOW });
      for (const s of sectors) {
        expect(s).toMatchObject({ ...SECTOR_DEFAULTS[level][s.sector], source: "default" });
        expect(s.level).not.toBe("all");
      }
    }
    // No choice yet asks everywhere; custom rules count as the safe stuff.
    const none = await person("sector-none", null);
    expect((await autopilotFor(none, "goals", { client })).level).toBe("ask");
  });

  it("acts only within the level and both caps, counting the month", async () => {
    const userId = await person("sector-caps");
    await setSectorAutopilot(
      userId,
      "goals",
      { level: "all", actionCapCents: 20_000, monthlyCapCents: 30_000 },
      { client, now: NOW },
    );
    expect(logAudit).toHaveBeenCalledWith(
      { type: "user", id: userId },
      "autopilot_sector_set",
      { type: "user", id: userId },
      { sector: "goals", level: "all", actionCapCents: 20_000, monthlyCapCents: 30_000 },
    );
    const act = (cents: number) =>
      mayAct(userId, "goals", { needs: "all", cents }, { client, now: NOW });
    expect(await act(20_000)).toMatchObject({ ok: true });
    expect(await act(20_001)).toMatchObject({ ok: false, reason: "action_cap" });
    await recordAct(userId, "goals", 20_000, "Moved $200 to savings", { client, now: NOW });
    expect(await act(10_000)).toMatchObject({ ok: true });
    expect(await act(10_001)).toMatchObject({ ok: false, reason: "monthly_cap" });
    // Last month's doesn't count.
    const nextMonth = new Date("2026-11-02T16:00:00Z");
    expect(
      await mayAct(userId, "goals", { needs: "all", cents: 20_000 }, { client, now: nextMonth }),
    ).toMatchObject({ ok: true });
    // Insurance still asks by default.
    expect(
      await mayAct(userId, "insurance", { needs: "all", cents: 0 }, { client, now: NOW }),
    ).toMatchObject({ ok: false, reason: "level" });
  });

  it("lets 'Ask me first' win over every sector, and refuses bad values", async () => {
    const userId = await person("sector-ask-wins");
    await setSectorAutopilot(userId, "bills", { level: "all" }, { client, now: NOW });
    await setAutopilot(userId, "ask", { client, now: NOW });
    expect((await autopilotFor(userId, "bills", { client, now: NOW })).level).toBe("ask");
    await expect(
      setSectorAutopilot(userId, "bills", { level: "all" }, { client, now: NOW }),
    ).rejects.toBeInstanceOf(SectorAutopilotError);
    const other = await person("sector-bad");
    await expect(setSectorAutopilot(other, "lottery", {}, { client })).rejects.toThrow(
      "Pick one of the areas.",
    );
    await expect(
      setSectorAutopilot(other, "bills", { monthlyCapCents: -1 }, { client }),
    ).rejects.toThrow(/up to \$100,000/);
    await setSectorAutopilot(other, "bills", { level: "ask" }, { client });
    await resetSectorAutopilot(other, "bills", { client });
    expect((await autopilotFor(other, "bills", { client })).source).toBe("default");
  });

  it("stops the bills rules and the goals upkeep when their areas always ask", async () => {
    const userId = await person("sector-wired");
    await setAutopilot(userId, "safe", { client, now: NOW });
    await client.finding.create({
      data: {
        userId,
        type: "duplicate_charge",
        key: `dup-${crypto.randomUUID()}`,
        title: "Charged twice at Target",
        annualSavingsCents: 6_420,
        confidence: "high",
        evidence: {},
      },
    });
    await setSectorAutopilot(userId, "bills", { level: "ask" }, { client, now: NOW });
    expect(await applyStandingRules(userId, { client, now: NOW })).toEqual([]);
    await setSectorAutopilot(userId, "bills", { level: "safe" }, { client, now: NOW });
    expect(await applyStandingRules(userId, { client, now: NOW })).toHaveLength(1);
    // And it's on the log.
    expect(await client.autopilotAct.count({ where: { userId, sector: "bills" } })).toBe(1);

    await setSectorAutopilot(userId, "goals", { level: "ask" }, { client, now: NOW });
    const spy = vi.spyOn(client.budgetTuneUp, "findFirst");
    expect(await runPlanUpkeep(userId, { client, now: NOW })).toEqual({ tuned: 0, counted: 0 });
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("switches insurance by itself only when allowed and within the caps", async () => {
    const userId = await person("sector-insurance");
    await client.plaidItem.create({
      data: {
        userId,
        plaidItemId: `demo-${crypto.randomUUID()}`,
        accessTokenEncrypted: "v1:unused",
      },
    });
    await ensureDemoPolicies(userId, { client, now: NOW });
    const [shop] = await reshopPerson(userId, { client, now: NOW });
    expect(shop?.pick).toBeTruthy();
    const monthly = Math.round(shop.pick!.annualPremiumCents / 12);

    // By default insurance always asks.
    expect(await insuranceAutopilot(userId, { client, now: NOW })).toBe(0);
    // Allowed, but the cap is a dollar too low.
    await setSectorAutopilot(
      userId,
      "insurance",
      { level: "all", actionCapCents: monthly - 100, monthlyCapCents: monthly * 2 },
      { client, now: NOW },
    );
    expect(await insuranceAutopilot(userId, { client, now: NOW })).toBe(0);
    // Within the caps: one switch, as a rule's yes, on the log.
    await setSectorAutopilot(
      userId,
      "insurance",
      { actionCapCents: monthly },
      { client, now: NOW },
    );
    expect(await insuranceAutopilot(userId, { client, now: NOW })).toBe(1);
    const decision = await client.decision.findFirstOrThrow({ where: { userId } });
    expect(decision).toMatchObject({ choice: "yes", source: "rule" });
    expect(
      await client.autopilotAct.findFirst({ where: { userId, sector: "insurance" } }),
    ).toMatchObject({
      cents: monthly,
    });
  });

  it("explains and changes it from the chat, only on the tap", async () => {
    const userId = await person("sector-chat");
    const intent = parseIntent("Let Jane handle insurance up to $50 a month", "2026-10-19");
    expect(intent).toEqual({
      kind: "autopilot_sector",
      sector: "insurance",
      level: "all",
      actionCapCents: null,
      monthlyCapCents: 5_000,
    });
    const reply = (await answerByRules(userId, intent, { client, now: NOW }))!;
    expect(reply.body).toMatch(
      /^Insurance would be everything allowed \(switch to a cheaper policy with the same cover\), up to \$50\.00 each time and \$50\.00 a month\. Now it's always asks\./,
    );
    // Typing changed nothing.
    expect((await autopilotFor(userId, "insurance", { client, now: NOW })).level).toBe("ask");
    const [message] = await postMessages(
      userId,
      [{ ...reply, kind: "reply", dedupeKey: "test:sector", priority: 1, source: "test" }],
      { client, now: NOW },
    ).then(() => client.janeMessage.findMany({ where: { userId } }));
    const { message: answered } = await takeChatAction(userId, message.id, "autopilot.sector_set", {
      client,
      now: NOW,
    });
    expect(answered.refs.note).toBe(
      "Done. Insurance: everything allowed, up to $50.00 each time and $50.00 a month, from now on.",
    );
    expect(await autopilotFor(userId, "insurance", { client, now: NOW })).toMatchObject({
      level: "all",
      actionCapCents: 5_000,
      monthlyCapCents: 5_000,
      source: "set",
    });

    const overview = await answerByRules(
      userId,
      { kind: "autopilot_overview" },
      { client, now: NOW },
    );
    expect(overview?.body).toMatch(/^Here's what I do by myself, area by area\./);
    expect(overview?.body).toContain(
      "- Insurance: everything allowed, up to $50.00 each time and $50.00 a month",
    );
    const tool = JSON.parse(
      (await runChatTool(userId, "autopilot_settings", {}, { client, now: NOW })).content,
    );
    expect(tool.areas).toHaveLength(6);
  });
});
