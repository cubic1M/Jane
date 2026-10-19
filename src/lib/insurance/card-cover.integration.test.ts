import { randomBytes } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import type { PlaidApi } from "plaid";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));

import { takeChatAction } from "@/lib/jane-agent/actions";
import { runChatTool } from "@/lib/jane-agent/claude-tools";
import { runJaneAgent } from "@/lib/jane-agent/run";
import { sendToJane } from "@/lib/jane-agent/typing";
import { parseActions, parseRefs } from "@/lib/jane-agent/types";
import { linkDemoBank } from "@/lib/plaid/demo";
import { syncItem } from "@/lib/plaid/sync";
import { cardCover } from "./card-cover";

// Cover you already have, against a real, migrated Postgres (spec step 152): the demo
// bank pays its phone bill with its card, whose phone protection makes the Asurion plan a
// duplicate. It's raised with the card's limits, said in the chat, and cancelled through
// the usual one-tap flow. A real bank's card the catalog doesn't know raises nothing.

const url = process.env.TEST_DATABASE_URL;
const LINKED = new Date("2026-10-18T15:00:00Z");

describe.runIf(url)("cover you already have, against a real database", () => {
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

  async function person() {
    const user = await client.user.create({
      data: { email: `ins-card-${crypto.randomUUID()}@example.com` },
    });
    created.push(user.id);
    return user.id;
  }

  beforeAll(() => {
    vi.stubEnv("TOKEN_ENCRYPTION_KEY", randomBytes(32).toString("base64"));
    vi.stubEnv("PLAID_CLIENT_ID", "");
    vi.stubEnv("PLAID_SECRET", "");
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    vi.stubEnv("RESEND_API_KEY", "");
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  });
  afterAll(async () => {
    await client.user.deleteMany({ where: { id: { in: created } } });
    await client.$disconnect();
    vi.unstubAllEnvs();
  });

  it("finds the plan the demo card already covers and cancels it with one Yes", async () => {
    const me = await person();
    const { itemId } = await linkDemoBank(me, { client, now: LINKED });
    await syncItem(itemId, { client, api: plaid, now: LINKED });

    const findings = await client.finding.findMany({ where: { userId: me } });
    const duplicate = findings.find((f) => f.type === "covered_by_card");
    expect(duplicate).toMatchObject({
      title: "Your Demo Credit Card already covers what Asurion does",
      annualSavingsCents: 1_700 * 12,
    });
    // Said as a duplicate, not a reshop.
    expect(findings.filter((f) => f.type === "insurance_reshop").map((f) => f.key)).not.toContain(
      "merchant:asurion",
    );

    const { cards, duplicates } = await cardCover(me, { client });
    expect(cards.map((c) => c.card)).toEqual(["Demo Credit Card"]);
    expect(duplicates).toMatchObject([
      { merchant: "Asurion", card: "Demo Credit Card", benefit: "Cell phone protection" },
    ]);

    // Jane brings up a couple of findings a day, the most urgent first: this one comes in turn.
    const messageFor = async () =>
      (await client.janeMessage.findMany({ where: { userId: me } })).find(
        (m) => parseRefs(m.refs).findingId === duplicate!.id,
      );
    let message;
    for (let day = 0; day < 20 && !message; day += 1) {
      const now = new Date(LINKED.getTime() + day * 86_400_000);
      await runJaneAgent(me, { client, now, trigger: "open" });
      message = await messageFor();
    }
    expect(message).toBeDefined();
    expect(parseActions(message!.actions).map((a) => a.id)).toContain("finding.yes");
    await takeChatAction(me, message!.id, "finding.yes", { client, now: LINKED });
    const action = await client.action.findFirst({
      where: { userId: me, decision: { findingId: duplicate!.id } },
    });
    expect(action).toMatchObject({ type: "cancel_subscription", status: "queued" });

    const { reply } = await sendToJane(me, "does my card cover my phone?", {
      client,
      now: LINKED,
    });
    expect(reply.body).toContain("Cell phone protection: Up to $800.00 a claim");
    const tool = JSON.parse(
      (await runChatTool(me, "insurance_card_cover", {}, { client, now: LINKED })).content,
    );
    expect(tool.payingTwice).toEqual([
      expect.objectContaining({ plan: "Asurion", aYear: "$204.00", status: "approved" }),
    ]);
  }, 120_000);

  it("never assumes a card the catalog doesn't know covers anything", async () => {
    const me = await person();
    await client.account.create({
      data: {
        userId: me,
        source: "csv",
        name: "Demo Credit Card",
        type: "credit",
        subtype: "credit card",
      },
    });
    expect(await cardCover(me, { client })).toEqual({ cards: [], duplicates: [] });
    const { reply } = await sendToJane(me, "do my cards come with any insurance?", {
      client,
      now: LINKED,
    });
    expect(reply.body).toMatch(/^I don't know of cover that comes with your cards yet\./);
  });
});
