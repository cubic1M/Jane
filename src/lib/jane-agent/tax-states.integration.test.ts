import { randomBytes } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import type { PlaidApi } from "plaid";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));

import { logAudit } from "@/lib/audit";
import { setAutopilot } from "@/lib/autopilot";
import { linkDemoBank } from "@/lib/plaid/demo";
import { syncItem } from "@/lib/plaid/sync";
import { loadTaxEstimate } from "@/lib/tax-estimate";
import { loadTaxPack } from "@/lib/tax-pack";
import { loadTaxProfile } from "@/lib/tax-profile";
import { ResidencyError, loadResidency, saveLocality, saveMoves } from "@/lib/tax-states";
import { taxPackCsv } from "@/planning/tax-pack";
import { takeChatAction } from "./actions";
import { runChatTool } from "./claude-tools";
import { loadSnapshot } from "./snapshot";
import { taxesSource } from "./sources/taxes";
import { parseActions, parseRefs } from "./types";
import { sendToJane } from "./typing";

// Spec step 165 against a real, migrated Postgres: the demo person's payments to state
// agencies switch from California to New York in August. Jane spots the move, splits the
// year's state taxes between the two, asks about New York City's tax, and puts both states
// in the pack, each with its source.

const url = process.env.TEST_DATABASE_URL;
const LINKED = new Date("2026-10-18T15:00:00Z");
const MINUTE = 60 * 1000;
const context = { now: LINKED, local: { date: "2026-10-18", hour: 8 }, trigger: "open" as const };

describe.runIf(url)("state and local taxes against a real database", { timeout: 60_000 }, () => {
  let client: PrismaClient;
  const created: string[] = [];
  const plaid = new Proxy(
    {},
    {
      get: () => () => {
        throw new Error("The demo bank must never call Plaid");
      },
    },
  ) as PlaidApi;
  let tick = 0;
  const later = () => new Date(LINKED.getTime() + ++tick * MINUTE);

  // The demo bank, with New York DMV payments from August.
  async function movedPerson(prefix: string) {
    const user = await client.user.create({
      data: { email: `${prefix}-${crypto.randomUUID()}@example.com` },
    });
    created.push(user.id);
    const { itemId } = await linkDemoBank(user.id, { client, now: LINKED });
    await syncItem(itemId, { client, api: plaid, now: LINKED });
    const checking = await client.account.findFirstOrThrow({
      where: { userId: user.id, subtype: "checking" },
    });
    for (const date of ["2026-08-03", "2026-09-14"]) {
      await client.transaction.create({
        data: {
          userId: user.id,
          accountId: checking.id,
          source: "plaid",
          date: new Date(`${date}T00:00:00Z`),
          amountCents: 6_500,
          description: "NY DMV REGISTRATION",
          pfcDetailed: "GOVERNMENT_AND_NON_PROFIT_GOVERNMENT_DEPARTMENTS_AND_AGENCIES",
        },
      });
    }
    return user.id;
  }
  const gather = async (userId: string) =>
    taxesSource.gather((await loadSnapshot(userId, { client, now: LINKED }))!, context);
  async function post(userId: string, dedupeKey: string) {
    const candidate = (await gather(userId)).find((c) => c.dedupeKey === dedupeKey)!;
    expect(candidate, dedupeKey).toBeDefined();
    return client.janeMessage.create({
      data: {
        userId,
        kind: candidate.kind,
        body: candidate.body,
        refs: candidate.refs,
        actions: candidate.actions,
        dedupeKey: `taxes:${dedupeKey}`,
      },
    });
  }

  beforeAll(() => {
    vi.stubEnv("TOKEN_ENCRYPTION_KEY", randomBytes(32).toString("base64"));
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    vi.stubEnv("PLAID_CLIENT_ID", "");
    vi.stubEnv("PLAID_SECRET", "");
    vi.stubEnv("AUTH_SECRET", "test-secret-for-unsubscribe-links");
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  });
  afterAll(async () => {
    await client.user.deleteMany({ where: { id: { in: created } } });
    await client.$disconnect();
    vi.unstubAllEnvs();
  });

  it("spots the move and asks, splitting nothing until the person says yes", async () => {
    const userId = await movedPerson("tax-move");
    const residency = await loadResidency(userId, 2026, { client });
    expect(residency).toMatchObject({
      told: null,
      spotted: { date: "2026-08-03", from: "CA", to: "NY" },
      usingSpotted: false,
      inUse: [],
    });
    const message = await post(userId, "move:2026:2026-08-03");
    expect(message.body).toMatch(
      /^It looks like you moved from California to New York on Aug 3: your payments to state agencies switched/,
    );
    expect(parseActions(message.actions).map((a) => a.id)).toEqual([
      "tax.move_yes",
      "tax.move_no",
      "open",
    ]);

    const after = (
      await takeChatAction(userId, message.id, "tax.move_yes", { client, now: later() })
    ).message;
    expect(after.refs.note).toBe(
      "Got it: you moved from California to New York on Aug 3. Your 2026 state taxes are split between California and New York, and New York is on your tax profile.",
    );
    expect(logAudit).toHaveBeenCalledWith(
      { type: "user", id: userId },
      "tax_profile_changed",
      { type: "user", id: userId },
      { fields: "moves", via: "chat" },
    );
    expect((await loadTaxProfile(userId, { client, now: LINKED })).state).toMatchObject({
      status: "yours",
      value: "NY",
    });

    // The estimate splits the year: wages by payday, the rest by days.
    const view = await loadTaxEstimate(userId, { client, now: LINKED });
    const state = view.estimate.state!;
    expect(state.code).toBe("NY");
    expect(state.parts.map((p) => [p.code, p.residence, p.from, p.to])).toEqual([
      ["CA", "part_year", "2026-01-01", "2026-08-02"],
      ["NY", "part_year", "2026-08-03", "2026-12-31"],
    ]);
    expect(state.parts[0].incomeCents + state.parts[1].incomeCents).toBeGreaterThan(
      view.estimate.agiCents - 100,
    );
    expect(state.parts[0].incomeCents).toBeGreaterThan(state.parts[1].incomeCents);
    expect(state.parts.map((p) => p.url)).toEqual([
      "https://www.ftb.ca.gov",
      "https://www.tax.ny.gov",
    ]);
    expect(view.assumptions).toContain(
      "You moved from California to New York on Aug 3, 2026: wages count where you lived on each payday, other income by the days you lived in each state.",
    );
    // Asked once a year.
    expect((await gather(userId)).some((c) => c.dedupeKey.startsWith("move:"))).toBe(false);
  });

  it("counts the move straight away at Handle the safe stuff, and asks to check it", async () => {
    const userId = await movedPerson("tax-move-auto");
    await setAutopilot(userId, "safe", { client, now: LINKED });
    const view = await loadTaxEstimate(userId, { client, now: LINKED });
    expect(view.residency.usingSpotted).toBe(true);
    expect(view.estimate.state!.parts.map((p) => p.code)).toEqual(["CA", "NY"]);
    expect(view.assumptions).toContain(
      "I've assumed you moved from California to New York on Aug 3, 2026: wages count where you lived on each payday, other income by the days you lived in each state.",
    );
    const message = await post(userId, "move:2026:2026-08-03");
    expect(message.body).toContain("I've counted your 2026 state taxes that way");

    // "No, same state" puts it back to one state and stops asking.
    await takeChatAction(userId, message.id, "tax.move_no", { client, now: later() });
    const after = await loadTaxEstimate(userId, { client, now: LINKED });
    expect(after.residency.told).toEqual([]);
    expect(after.estimate.state!.parts).toHaveLength(1);
  });

  it("asks about New York City's tax and adds it", async () => {
    const userId = await movedPerson("tax-local");
    await saveMoves(userId, 2026, [{ date: "2026-08-03", from: "CA", to: "NY" }], {
      client,
      now: LINKED,
      via: "page",
    });
    const message = await post(userId, "local:NY");
    expect(message.body).toBe(
      "Do you live in New York City or Yonkers? They have their own income tax on top of New York's, which I'd add to your estimate.",
    );
    expect(parseRefs(message.refs).taxLocals).toEqual(["nyc", "yonkers"]);
    const after = (
      await takeChatAction(userId, message.id, "tax.local_1", { client, now: later() })
    ).message;
    expect(after.refs.note).toBe("Got it: New York City's income tax is in your estimate now.");
    const local = (await loadTaxEstimate(userId, { client, now: LINKED })).estimate.state!.local;
    expect(local).toMatchObject({ key: "nyc", label: "New York City" });
    expect(local!.taxCents).toBeGreaterThan(0);
    expect((await gather(userId)).some((c) => c.dedupeKey === "local:NY")).toBe(false);

    // Only a city in the person's state.
    await expect(
      saveLocality(userId, "detroit", { client, via: "page", state: "NY" }),
    ).rejects.toBeInstanceOf(ResidencyError);
  });

  it("puts both states in the pack, each with its source", async () => {
    const userId = await movedPerson("tax-pack-states");
    await saveMoves(userId, 2026, [{ date: "2026-08-03", from: "CA", to: "NY" }], {
      client,
      now: LINKED,
      via: "page",
    });
    const pack = await loadTaxPack(userId, 2026, { client, now: LINKED });
    expect(pack.states).toEqual([
      {
        code: "CA",
        from: "2026-01-01",
        to: "2026-08-02",
        nonresident: false,
        agency: "California Franchise Tax Board",
        url: "https://www.ftb.ca.gov",
      },
      {
        code: "NY",
        from: "2026-08-03",
        to: "2026-12-31",
        nonresident: false,
        agency: "New York State Department of Taxation and Finance",
        url: "https://www.tax.ny.gov",
      },
    ]);
    expect(taxPackCsv(pack)).toContain(
      "States you lived or worked in,2026-01-01 to 2026-08-02,California Franchise Tax Board,,https://www.ftb.ca.gov",
    );
  });

  it("answers typed moves, an out-of-state employer and state taxes, and gives Claude it", async () => {
    const userId = await movedPerson("tax-states-chat");
    const move = (
      await sendToJane(userId, "I moved from California to New York on August 3rd", {
        client,
        now: later(),
      })
    ).reply;
    expect(move.body).toMatch(/^You moved from California to New York on Aug 3, 2026\?/);
    expect(parseRefs(move.refs).taxMove).toEqual({ date: "2026-08-03", from: "CA", to: "NY" });
    await takeChatAction(userId, move.id, "tax.move_set", { client, now: later() });
    expect((await loadResidency(userId, 2026, { client })).told).toEqual([
      { date: "2026-08-03", from: "CA", to: "NY" },
    ]);

    const work = (
      await sendToJane(userId, "I work remotely for a company in Connecticut", {
        client,
        now: later(),
      })
    ).reply;
    expect(work.body).toMatch(
      /^Connecticut taxes the wages of people who work from home for employers there/,
    );
    await takeChatAction(userId, work.id, "tax.work_set", { client, now: later() });
    const parts = (await loadTaxEstimate(userId, { client, now: LINKED })).estimate.state!.parts;
    expect(parts.map((p) => [p.code, p.residence])).toEqual([
      ["CA", "part_year"],
      ["NY", "part_year"],
      ["CT", "nonresident"],
    ]);
    // New York credits Connecticut's tax on the wages earned while living there.
    expect(parts[1].creditCents).toBeGreaterThan(0);

    const states = (await sendToJane(userId, "what state taxes do I pay", { client, now: later() }))
      .reply;
    expect(states.body).toMatch(
      /^Your 2026 state taxes come to about \$[\d,]+, estimated\.\n• California \(lived there/,
    );
    expect(states.body).toContain("Figures from California Franchise Tax Board;");

    const tool = JSON.parse(
      (await runChatTool(userId, "tax_states", {}, { client, now: LINKED })).content,
    );
    expect(tool.states.map((s: { state: string }) => s.state)).toEqual([
      "California",
      "New York",
      "Connecticut",
    ]);
    expect(tool.states[0].source).toBe("https://www.ftb.ca.gov");
    expect(tool.employerState).toBe("Connecticut");
  });
});
