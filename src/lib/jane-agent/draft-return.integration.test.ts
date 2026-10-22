import { randomBytes } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import type { PlaidApi } from "plaid";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));

import { TAX_DETECTORS } from "@/detectors/taxes";
import { runDetectors } from "@/detectors";
import { DraftReturnError, confirmDraftReturn, readDraftReturn } from "@/lib/draft-return";
import { linkDemoBank } from "@/lib/plaid/demo";
import { syncItem } from "@/lib/plaid/sync";
import { loadProfileInput } from "@/lib/profile";
import { collectTaxDocuments } from "@/lib/tax-documents";
import { buildProfile } from "@/profile/build";
import { takeChatAction } from "./actions";
import { runChatTool } from "./claude-tools";
import { loadSnapshot } from "./snapshot";
import { taxesSource } from "./sources/taxes";
import { parseTaxIntent } from "./tax-intents";
import { parseActions } from "./types";
import { sendToJane } from "./typing";

// Spec step 272 against a real, migrated Postgres: a draft return uploaded before filing, read by
// the stand-in (the demo draft, three mistakes planted), confirmed in the chat, and checked line
// by line against the forms Jane collected: all three found, each a card with its dollars, and
// nothing filed.

const url = process.env.TEST_DATABASE_URL;
const LINKED = new Date("2026-10-18T15:00:00Z");
const MAR = new Date("2027-03-01T16:00:00Z");
const context = { now: MAR, local: { date: "2027-03-01", hour: 8 }, trigger: "open" as const };

describe("the draft return questions people ask", () => {
  it.each([
    "can you check my draft return",
    "check my return before i file",
    "turbotax says i get a refund, is it right",
  ])("reads %j as the draft question", (text) => {
    expect(parseTaxIntent(text)).toEqual({ kind: "tax", ask: "draft" });
  });

  it("leaves last year's return to its own answer", () => {
    expect(parseTaxIntent("check my return")).not.toEqual({ kind: "tax", ask: "draft" });
  });
});

describe.runIf(url)("a draft return checked before filing", { timeout: 120_000 }, () => {
  let client: PrismaClient;
  const created: string[] = [];
  const plaid = new Proxy(
    {},
    {
      get: () => () => {
        throw new Error("no plaid");
      },
    },
  ) as PlaidApi;

  async function person(prefix: string) {
    const user = await client.user.create({
      data: { email: `${prefix}-${crypto.randomUUID()}@example.com` },
    });
    created.push(user.id);
    const { itemId } = await linkDemoBank(user.id, { client, now: LINKED });
    await syncItem(itemId, { client, api: plaid, now: LINKED });
    await collectTaxDocuments(user.id, { client, now: MAR, tick: false });
    const document = await client.document.create({
      data: {
        userId: user.id,
        kind: "draft_return",
        fileName: "2026-draft.pdf",
        contentType: "application/pdf",
        sizeBytes: 3,
        encryptedBytes: Buffer.from("abc"),
      },
    });
    return { userId: user.id, documentId: document.id };
  }
  const gather = async (userId: string) =>
    taxesSource.gather((await loadSnapshot(userId, { client, now: MAR }))!, context);

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

  it("finds all three planted mistakes in the demo draft, each a card with its dollars, and files nothing", async () => {
    const { userId, documentId } = await person("draft");
    const reading = (await readDraftReturn(userId, documentId, { client, now: MAR }))!;
    expect(reading.status).toBe("waiting");
    expect(reading.year).toBe(2026);
    expect(reading.sources.wages).toBe("demo");

    const ask = (await gather(userId)).find((c) => c.dedupeKey === `draft:${reading.id}`)!;
    expect(ask.kind).toBe("decision");
    expect(ask.body).toMatch(/^I read your 2026 draft return: wages \$[\d,.]+, total tax/);
    const message = await client.janeMessage.create({
      data: {
        userId,
        kind: ask.kind,
        body: ask.body,
        refs: ask.refs,
        actions: ask.actions,
        dedupeKey: `taxes:${ask.dedupeKey}`,
      },
    });
    expect(parseActions(message.actions).map((a) => a.id)).toEqual([
      "tax.draft_confirm",
      "open",
      "tax.draft_dismiss",
    ]);
    const after = await takeChatAction(userId, message.id, "tax.draft_confirm", {
      client,
      now: MAR,
    });
    expect(after.message.refs.note).toBe(
      "Checked: 3 things to fix before you file. I'll show each one.",
    );

    const cards = (await gather(userId)).filter((c) =>
      c.dedupeKey.startsWith(`draft:${reading.id}:`),
    );
    expect(cards.map((c) => c.dedupeKey.split(":").at(-1)).sort()).toEqual([
      "capitalGains",
      "federalWithheld",
      "student_loan_interest",
    ]);
    const withheld = cards.find((c) => c.dedupeKey.endsWith(":federalWithheld"))!;
    expect(withheld.body).toMatch(
      /^Federal tax withheld doesn't match your forms \(Form 1040 line 25d\): about \$1,000\.00 back\./,
    );
    expect(withheld.body).toContain("I don't file it.");
    for (const c of cards) expect(c.body).toMatch(/about \$[\d,]+\.\d\d (back|more tax)/);

    // A second confirm is refused; nothing was filed or sent anywhere.
    await expect(confirmDraftReturn(userId, reading.id, { client, now: MAR })).rejects.toThrow(
      DraftReturnError,
    );
    expect(await client.taxReturn.count({ where: { userId } })).toBe(0);

    const tool = JSON.parse(
      (await runChatTool(userId, "tax_draft_check", {}, { client, now: MAR })).content,
    );
    expect(tool.janeFiles).toBe(false);
    expect(tool.drafts[0].findings).toHaveLength(3);

    const { reply } = await sendToJane(userId, "check my return before I file", {
      client,
      now: MAR,
    });
    expect(reply.body).toMatch(/^Here is what I found in your 2026 draft\./);

    // The detector brings it up unasked, from the checked draft.
    const input = await loadProfileInput(userId, { client, now: MAR });
    const s = runDetectors({ profile: buildProfile(input), data: input }, TAX_DETECTORS).find(
      (x) => x.topic === "draft_return_check",
    )!;
    expect(s).toMatchObject({ urgency: "now", worthKind: "risk" });
    expect(s.title).toBe("Fix 3 things in your 2026 draft return before you file");
  });

  it("keeps a draft the person says isn't one out of everything", async () => {
    const { userId, documentId } = await person("draft-no");
    const reading = (await readDraftReturn(userId, documentId, { client, now: MAR }))!;
    const ask = (await gather(userId)).find((c) => c.dedupeKey === `draft:${reading.id}`)!;
    const message = await client.janeMessage.create({
      data: {
        userId,
        kind: ask.kind,
        body: ask.body,
        refs: ask.refs,
        actions: ask.actions,
        dedupeKey: `taxes:${ask.dedupeKey}`,
      },
    });
    await takeChatAction(userId, message.id, "tax.draft_dismiss", { client, now: MAR });
    expect((await gather(userId)).some((c) => c.dedupeKey.startsWith("draft:"))).toBe(false);
  });
});
