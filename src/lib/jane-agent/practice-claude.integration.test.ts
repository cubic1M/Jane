import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));
vi.mock("@/lib/advice-mode", () => ({ adviceMode: vi.fn(async () => true) }));

import { adviceMode } from "@/lib/advice-mode";
import { runAutopilot } from "@/lib/practice/autopilot";
import { loadPractice, startPractice } from "@/lib/practice/portfolio";
import { runPracticeDay } from "@/lib/practice/scan";
import { takeChatAction } from "./actions";
import { CHAT_TOOLS, proposeAction, runChatTool } from "./claude-tools";
import { toolsFor } from "./tool-select";

// Spec step 297 for Claude (found in the investing debugging pass): every typed message is
// Claude's, so the practice portfolio needs a tool ("what did you buy this week and why") and a
// button Claude can offer for "pause it". Practice money only, demo advice mode only.

const url = process.env.TEST_DATABASE_URL;
const at = (day: string) => new Date(`${day}T21:00:00Z`);

describe.runIf(url)("the practice portfolio for Claude", () => {
  let client: PrismaClient;
  const created: string[] = [];

  beforeAll(() => {
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url! }) });
  });
  afterAll(async () => {
    await client.user.deleteMany({ where: { id: { in: created } } });
    await client.$disconnect();
  });

  async function person() {
    const user = await client.user.create({
      data: { email: `practice-claude-${crypto.randomUUID()}@example.com` },
    });
    created.push(user.id);
    return user.id;
  }

  it("reads the portfolio and this week's trades, each with its rule and reason", async () => {
    const userId = await person();
    const none = await runChatTool(
      userId,
      "practice_portfolio",
      {},
      { client, now: at("2026-10-16") },
    );
    expect(JSON.parse(none.content).note).toMatch(/No practice portfolio yet/);

    await startPractice(userId, 4, { client, now: at("2026-10-12") });
    await runAutopilot(userId, { client, now: at("2026-10-12") });
    await runPracticeDay(userId, { client, now: at("2026-10-16") });
    const out = await runChatTool(
      userId,
      "practice_portfolio",
      {},
      { client, now: at("2026-10-16") },
    );
    const data = JSON.parse(out.content);
    expect(data).toMatchObject({ level: "High", paused: false, opportunitiesPaused: false });
    expect(data.practiceMoneyOnly).toMatch(/nothing real was bought or sold/);
    expect(data.thisWeek.length).toBeGreaterThan(0);
    for (const t of data.thisWeek) {
      expect(["buy", "sell"]).toContain(t.side);
      expect(t.reason.length).toBeGreaterThan(0);
      expect(t.rule.length).toBeGreaterThan(0);
    }
    // Its figures are recorded for the guardrails.
    expect(out.cents.length).toBeGreaterThan(0);
  });

  it("offers a pause or resume button that sets the switch on a tap", async () => {
    const userId = await person();
    const now = at("2026-10-16");
    expect(await proposeAction(userId, { action: "practice.pause" }, { client, now })).toEqual({
      ok: false,
      error: "There's no practice portfolio to pause or resume.",
    });
    await startPractice(userId, 3, { client, now });

    const offer = await proposeAction(
      userId,
      { action: "practice.pause", which: "opportunities" },
      { client, now },
    );
    expect(offer).toMatchObject({
      ok: true,
      actions: [{ id: "practice.pause", label: "Pause opportunities", kind: "primary" }],
      refs: { advice: true, practiceWhich: "opportunities" },
    });
    if (!offer.ok) throw new Error("no offer");
    // Resuming what is running isn't offered.
    expect((await proposeAction(userId, { action: "practice.resume" }, { client, now })).ok).toBe(
      false,
    );

    const posted = await client.janeMessage.create({
      data: {
        userId,
        kind: "reply",
        body: "Pause opportunities?",
        refs: offer.refs,
        actions: offer.actions,
        dedupeKey: `test:practice:${crypto.randomUUID()}`,
      },
    });
    await takeChatAction(userId, posted.id, "practice.pause", { client, now });
    const view = await loadPractice(userId, { client, now });
    expect(view).toMatchObject({ paused: false, opportunitiesPaused: true });
  });

  it("refuses outside demo advice mode, and the tool says why", async () => {
    const userId = await person();
    const now = at("2026-10-16");
    await startPractice(userId, 3, { client, now });
    vi.mocked(adviceMode).mockResolvedValue(false);
    try {
      expect((await proposeAction(userId, { action: "practice.pause" }, { client, now })).ok).toBe(
        false,
      );
      const out = await runChatTool(userId, "practice_portfolio", {}, { client, now });
      expect(JSON.parse(out.content).note).toMatch(/demo advice/);
    } finally {
      vi.mocked(adviceMode).mockResolvedValue(true);
    }
  });

  it("is sent with the investing questions about it", () => {
    const names = (text: string) =>
      toolsFor(CHAT_TOOLS, text, null, null, "2026-10-16").map((t) => t.name);
    expect(names("what did you buy this week and why")).toContain("practice_portfolio");
    expect(names("pause it")).toContain("practice_portfolio");
  });
});
