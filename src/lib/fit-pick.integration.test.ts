import { randomBytes } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import type { PlaidApi } from "plaid";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));

import { DEMO_ADVICE_LABEL } from "@/config/advice";
import { track } from "@/lib/analytics";
import { listQueue } from "@/lib/concierge";
import { runChatTool } from "@/lib/jane-agent/claude-tools";
import { linkDemoBank } from "@/lib/plaid/demo";
import { syncItem } from "@/lib/plaid/sync";
import { DecisionError, undoPick } from "@/lib/decisions";
import { describePlanOptions } from "@/lib/plan-options";
import { loadFit } from "./fit";
import { fitCard, fitCardProblems } from "./fit-card";
import { FitPickError, pickFitOption } from "./fit-pick";

// Spec step 282 against a real, migrated Postgres, on the Reyes' demo bank: the loan options card
// from Claude's tool, and a pick queued for the concierge team through the usual finding,
// decision and action, never an application.

const url = process.env.TEST_DATABASE_URL;
const NOW = new Date("2026-10-18T15:00:00Z");
const ADMIN = { id: "admin_1" };

describe.runIf(url)("picking a loan option", { timeout: 120_000 }, () => {
  let client: PrismaClient;
  let reyes: string;
  let real: string;
  const created: string[] = [];
  const plaid = new Proxy(
    {},
    {
      get: () => () => {
        throw new Error("The demo bank must never call Plaid");
      },
    },
  ) as PlaidApi;

  beforeAll(async () => {
    vi.stubEnv("TOKEN_ENCRYPTION_KEY", randomBytes(32).toString("base64"));
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    vi.stubEnv("PLAID_CLIENT_ID", "");
    vi.stubEnv("PLAID_SECRET", "");
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
    const user = await client.user.create({
      data: { email: `fit-pick-${crypto.randomUUID()}@example.com` },
    });
    created.push(user.id);
    const { itemId } = await linkDemoBank(user.id, { client, now: NOW, person: "family" });
    await syncItem(itemId, { client, api: plaid, now: NOW });
    reyes = user.id;
    // No bank linked: not demo advice mode.
    const other = await client.user.create({
      data: { email: `fit-pick-real-${crypto.randomUUID()}@example.com` },
    });
    created.push(other.id);
    real = other.id;
  }, 180_000);
  afterAll(async () => {
    await client.user.deleteMany({ where: { id: { in: created } } });
    await client.$disconnect();
    vi.unstubAllEnvs();
  });

  it("gives Claude the options card with the loan_fit tool, the pick marked in advice mode", async () => {
    const tool = JSON.parse(
      (
        await runChatTool(
          reyes,
          "loan_fit",
          { need: "car", amount_dollars: 25_000 },
          { client, now: NOW },
        )
      ).content,
    );
    const card = tool.optionCard;
    expect(card.kind).toBe("loan");
    expect(card.topic).toBe("car:2500000");
    expect(card.advice).toBe(true);
    expect(fitCardProblems(card)).toEqual([]);
    expect(card.options.length).toBeGreaterThanOrEqual(2);
    expect(card.options.length).toBeLessThanOrEqual(4);
    expect(card.options[0].id).toBe(tool.pick);
    expect(card.options[0].isPick).toBe(true);
    expect(card.options[0].confidence.percent).toBeLessThanOrEqual(75);
    expect(tool.label).toBe(DEMO_ADVICE_LABEL);
  });

  it("queues a pick for the team in /admin/queue, with what was picked, and never applies", async () => {
    const view = await loadFit(
      reyes,
      { need: "car", amountCents: 2_500_000 },
      { client, now: NOW },
    );
    const card = fitCard(view, true)!;
    const chosen = card.options[1];
    const result = await pickFitOption(reyes, card.topic, chosen.id, { client, now: NOW });
    expect(result.kept).toBe(false);

    const action = await client.action.findUniqueOrThrow({
      where: { id: result.actionId! },
      include: { decision: { include: { finding: true } } },
    });
    expect(action).toMatchObject({ userId: reyes, type: "card_interest", status: "queued" });
    expect(action.decision).toMatchObject({ choice: "yes", source: "chat" });
    expect(action.decision.finding.status).toBe("approved");
    const picked = (action.decision.options as { loanPick: Record<string, unknown> }).loanPick;
    expect(picked).toMatchObject({
      topic: "car:2500000",
      optionId: chosen.id,
      lender: chosen.label,
      paymentCents: chosen.priceCents,
      wasPick: false,
    });
    const snapshot = action.decision.cardSnapshot as { whatChanges: string; explanation: string };
    expect(snapshot.whatChanges).toBe(
      `We check the option you picked and send you ${chosen.label}'s steps to apply yourself. Nothing is applied for and no money moves until you do it.`,
    );
    expect(snapshot.explanation).toContain(chosen.headline);
    expect(describePlanOptions("card_interest", action.decision.options)[0]).toMatch(
      new RegExp(
        `^Loan picked: ${chosen.label} at \\d+\\.\\d\\d% for \\d+ months, \\$[\\d,.]+ a month$`,
      ),
    );

    const queue = await listQueue(ADMIN, { type: "card_interest", status: null }, { client });
    expect(queue.map((a) => a.id)).toContain(result.actionId);
    // Choosing never applies for anything.
    expect(await client.loanApplication.count({ where: { userId: reyes } })).toBe(0);
    expect(track).toHaveBeenCalledWith(reyes, "loan_option_picked", {
      need: "car",
      kept: false,
      was_pick: false,
    });
  });

  it("queues once: a second pick for the same thing this month is refused", async () => {
    const view = await loadFit(
      reyes,
      { need: "car", amountCents: 2_500_000 },
      { client, now: NOW },
    );
    const card = fitCard(view, true)!;
    await expect(
      pickFitOption(reyes, card.topic, card.options[0].id, { client, now: NOW }),
    ).rejects.toThrow(new FitPickError("You've already chosen one of these this month."));
  });

  it("takes a pick back with Revert while it's queued, and the same choice can be made again", async () => {
    const view = await loadFit(
      reyes,
      { need: "personal", amountCents: 800_000 },
      { client, now: NOW },
    );
    const card = fitCard(view, true)!;
    const first = await pickFitOption(reyes, card.topic, card.options[0].id, { client, now: NOW });
    await undoPick(reyes, first.decisionId, { client, now: NOW });
    expect(await client.action.count({ where: { decisionId: first.decisionId } })).toBe(0);
    const undone = await client.decision.findUniqueOrThrow({
      where: { id: first.decisionId },
      include: { finding: true },
    });
    expect(undone.undoneAt).not.toBeNull();
    expect(undone.finding.status).toBe("declined");
    // Picked again, another option this time: allowed, and queued.
    const again = await pickFitOption(reyes, card.topic, card.options[1].id, { client, now: NOW });
    expect(again.actionId).not.toBeNull();
    // Not twice, and not someone else's.
    await expect(undoPick(reyes, first.decisionId, { client, now: NOW })).rejects.toThrow(
      DecisionError,
    );
    await expect(undoPick(real, again.decisionId, { client, now: NOW })).rejects.toThrow(
      DecisionError,
    );
    // Not once the team has started.
    await client.action.update({ where: { id: again.actionId! }, data: { status: "in_progress" } });
    await expect(undoPick(reyes, again.decisionId, { client, now: NOW })).rejects.toThrow(
      "the team has started",
    );
  });

  it("refuses an option that isn't on the card, a topic it can't read, and outside advice mode", async () => {
    await expect(
      pickFitOption(reyes, "personal:800000", "demo-made-up-1-36", { client, now: NOW }),
    ).rejects.toThrow("That option isn't available anymore");
    await expect(pickFitOption(reyes, "boat:5", "x", { client, now: NOW })).rejects.toThrow(
      "That option isn't available anymore",
    );
    await expect(pickFitOption(real, "car:2500000", "keep", { client, now: NOW })).rejects.toThrow(
      "only available in demo mode",
    );
    expect(await client.action.count({ where: { userId: real } })).toBe(0);
  });
});
