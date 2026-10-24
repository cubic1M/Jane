import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));
vi.mock("@/lib/advice-mode", () => ({ adviceMode: vi.fn(async () => true) }));

import { CATALOG_EVIDENCE } from "@/config/catalog-evidence";
import { CATALOG, CATALOG_IDS } from "@/config/strategy-catalog";
import { proposePracticeChange } from "@/lib/jane-agent/practice-tools";
import { runAutopilot } from "./autopilot";
import { startPractice } from "./portfolio";
import { practiceProfileOf, savePreferences } from "./preferences";

// Following a tested strategy in practice, against a real, migrated Postgres and the sample
// market: one worth watching at the level runs the portfolio by its own rule; one that isn't
// leaves the mix in place.

const url = process.env.TEST_DATABASE_URL;
const NOW = new Date("2026-10-20T21:30:00Z");

const at3 = (ok: boolean) =>
  CATALOG_IDS.find((id) => {
    const e = CATALOG_EVIDENCE[id]?.[3];
    return CATALOG[id].kind === "portfolio" && e && (e.watch || e.recommendable) === ok;
  })!;

describe.runIf(url)("following a tested strategy", () => {
  let client: PrismaClient;
  const created: string[] = [];
  const person = async (catalogStrategy: string) => {
    const user = await client.user.create({
      data: { email: `follow-${crypto.randomUUID()}@example.com` },
    });
    created.push(user.id);
    await savePreferences(user.id, { riskLevel: 3, catalogStrategy }, "page", { client, now: NOW });
    await startPractice(user.id, 3, { client, now: NOW });
    return user.id;
  };

  beforeAll(() => {
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url! }) });
  });
  afterAll(async () => {
    await client.user.deleteMany({ where: { id: { in: created } } });
    await client.$disconnect();
  });

  it("runs the portfolio by a worth-watching strategy's own rule", async () => {
    const id = await person(at3(true));
    const profile = await practiceProfileOf(id, { client, now: NOW });
    expect(profile.catalog?.id).toBe(at3(true));
    expect(profile.rules.join(" ")).toMatch(/instead of the mix/);
    const r = await runAutopilot(id, { client, now: NOW });
    if (!r.ran) throw new Error("did not run");
    const trades = await client.practiceTrade.findMany({ where: { userId: id, side: "buy" } });
    expect(trades.length).toBeGreaterThan(0);
    expect(trades.every((t) => t.rule === "catalog_follow")).toBe(true);
    for (const t of trades) expect([...CATALOG[at3(true)].tickers, "BIL"]).toContain(t.ticker);
    expect(trades[0].reason).toMatch(/^Following /);
  });

  it("keeps the mix for one the research doesn't rate at the level", async () => {
    const id = await person(at3(false));
    const profile = await practiceProfileOf(id, { client, now: NOW });
    expect(profile.catalog).toBeNull();
    expect(profile.rules.join(" ")).toMatch(/waits/);
    const r = await runAutopilot(id, { client, now: NOW });
    if (!r.ran) throw new Error("did not run");
    const trades = await client.practiceTrade.findMany({ where: { userId: id, side: "buy" } });
    expect(trades.some((t) => t.rule === "catalog_follow")).toBe(false);
  });

  it("is offered in the chat only where the research rates it", async () => {
    const id = await person("off");
    const yes = await proposePracticeChange(
      id,
      { catalog_strategy: at3(true) },
      { client, now: NOW },
    );
    expect(yes.ok && yes.line).toMatch(/A tested strategy instead of the mix: Off → /);
    const no = await proposePracticeChange(
      id,
      { catalog_strategy: at3(false) },
      { client, now: NOW },
    );
    expect(no.ok).toBe(false);
    expect(!no.ok && no.error).toMatch(/doesn't rate .* worth watching/);
  });
});
