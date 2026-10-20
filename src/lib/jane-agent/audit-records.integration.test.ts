import { randomBytes } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import type { PlaidApi } from "plaid";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));

import { setAutopilot } from "@/lib/autopilot";
import { loadAuditRecords, remindRetention } from "@/lib/audit-records";
import { linkDemoBank } from "@/lib/plaid/demo";
import { syncItem } from "@/lib/plaid/sync";
import { runTaxAutopilot } from "@/lib/tax-autopilot";
import { takeChatAction } from "./actions";
import { runChatTool } from "./claude-tools";
import { loadSnapshot } from "./snapshot";
import { taxesSource } from "./sources/taxes";
import { sendToJane } from "./typing";

// Spec step 171 against a real, migrated Postgres: the demo person's deductions, each with
// its sources; a big gift whose receipt isn't there is "still needed", and a receipt in the
// vault satisfies it; records for old years come with a reminder, and nothing is deleted.

const url = process.env.TEST_DATABASE_URL;
const LINKED = new Date("2026-10-18T15:00:00Z");
// Records for 2022 can go after 2026-04-15; the reminder is due from 2026-03-16.
const SOON = new Date("2026-04-01T15:00:00Z");

describe.runIf(url)("audit-ready records against a real database", { timeout: 60_000 }, () => {
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

  async function person(prefix: string) {
    const user = await client.user.create({
      data: { email: `${prefix}-${crypto.randomUUID()}@example.com` },
    });
    created.push(user.id);
    const { itemId } = await linkDemoBank(user.id, { client, now: LINKED });
    await syncItem(itemId, { client, api: plaid, now: LINKED });
    const checking = await client.account.findFirstOrThrow({
      where: { userId: user.id, subtype: "checking" },
    });
    const gift = await client.transaction.create({
      data: {
        userId: user.id,
        accountId: checking.id,
        source: "plaid",
        date: new Date("2026-09-12T00:00:00Z"),
        amountCents: 300_000,
        description: "AMERICAN RED CROSS",
        merchantName: "American Red Cross",
        pfcDetailed: "GOVERNMENT_AND_NON_PROFIT_DONATIONS",
      },
    });
    return { userId: user.id, giftId: gift.id };
  }
  const addReceipt = (userId: string) =>
    client.document.create({
      data: {
        userId,
        kind: "receipt",
        fileName: "red-cross-receipt.pdf",
        contentType: "application/pdf",
        sizeBytes: 3,
        encryptedBytes: Buffer.from("abc"),
        purchaseDate: new Date("2026-09-13T00:00:00Z"),
        purchaseAmountCents: 300_000,
      },
    });

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

  it("ties every item in the pack to its sources, and says what's still needed", async () => {
    const { userId, giftId } = await person("records");
    const pack = await loadAuditRecords(userId, 2026, { client, now: LINKED });
    expect(pack.items.length).toBeGreaterThan(0);
    // Nothing in the pack lacks its source.
    for (const item of pack.items) expect(item.evidence.length, item.label).toBeGreaterThan(0);
    const donations = pack.items.find((i) => i.key === "charity")!;
    expect(donations.evidence).toContainEqual(
      expect.objectContaining({ kind: "transaction", id: giftId, receipt: false }),
    );
    expect(donations.needs).toEqual(["The charity's receipt for your gift to American Red Cross."]);
    expect(pack.incomplete.map((i) => i.key)).toContain("charity");
    expect(pack.items.find((i) => i.key === "mortgage_interest")!.evidence[0]).toMatchObject({
      kind: "loan",
      name: "Demo Home Loan",
    });
  });

  it("is satisfied by a matching receipt in the vault", async () => {
    const { userId, giftId } = await person("records-receipt");
    const receipt = await addReceipt(userId);
    const donations = (await loadAuditRecords(userId, 2026, { client, now: LINKED })).items.find(
      (i) => i.key === "charity",
    )!;
    expect(donations.needs).toEqual([]);
    expect(donations.evidence).toContainEqual({
      kind: "receipt",
      id: receipt.id,
      fileName: "red-cross-receipt.pdf",
    });
    expect(donations.evidence).toContainEqual(
      expect.objectContaining({ kind: "transaction", id: giftId, receipt: true }),
    );
  });

  it("follows the retention config, reminds once, and deletes nothing", async () => {
    const { userId } = await person("records-keep");
    const old = await client.transaction.create({
      data: {
        userId,
        accountId: (
          await client.account.findFirstOrThrow({ where: { userId, subtype: "checking" } })
        ).id,
        source: "plaid",
        date: new Date("2022-06-01T00:00:00Z"),
        amountCents: 1_000,
        description: "OLD CHARGE",
        pfcDetailed: "GENERAL_MERCHANDISE_OTHER_GENERAL_MERCHANDISE",
      },
    });
    const view = await loadAuditRecords(userId, 2026, { client, now: SOON });
    const r2022 = view.retention.find((r) => r.year === 2022)!;
    expect(r2022).toMatchObject({ keepUntil: "2026-04-15", status: "soon" });
    expect(view.due.map((r) => r.year)).toContain(2022);

    // Ask level: Jane says so, with a button.
    const candidate = taxesSource
      .gather((await loadSnapshot(userId, { client, now: SOON }))!, {
        now: SOON,
        local: { date: "2026-04-01", hour: 8 },
        trigger: "open",
      })
      .find((c) => c.dedupeKey === "records:2022")!;
    expect(candidate.body).toBe(
      "Your 2022 tax records can be thrown away after Apr 15 (3 years after the return was due or filed, whichever is later.). I never delete anything; want a reminder on your deadlines?",
    );
    const message = await client.janeMessage.create({
      data: {
        userId,
        kind: candidate.kind,
        body: candidate.body,
        refs: candidate.refs,
        actions: candidate.actions,
        dedupeKey: `taxes:${candidate.dedupeKey}`,
      },
    });
    const after = (
      await takeChatAction(userId, message.id, "tax.records_remind", { client, now: SOON })
    ).message;
    expect(after.refs.note).toBe(
      "Done: a reminder about your 2022 records is on your deadlines. I won't delete anything.",
    );
    expect(
      await client.deadline.count({
        where: { userId, title: "Records for your 2022 taxes can go after 2026-04-15" },
      }),
    ).toBe(1);
    expect((await loadAuditRecords(userId, 2026, { client, now: SOON })).due).toEqual([]);
    // Nothing deleted.
    expect(await client.transaction.count({ where: { id: old.id } })).toBe(1);
    await expect(remindRetention(userId, 1990, { client, now: SOON, via: "page" })).rejects.toThrow(
      "isn't on your list",
    );
  });

  it("sets the reminder by itself at Handle the safe stuff", async () => {
    const { userId } = await person("records-auto");
    await client.transaction.create({
      data: {
        userId,
        accountId: (
          await client.account.findFirstOrThrow({ where: { userId, subtype: "checking" } })
        ).id,
        source: "plaid",
        date: new Date("2022-06-01T00:00:00Z"),
        amountCents: 1_000,
        description: "OLD CHARGE",
        pfcDetailed: "GENERAL_MERCHANDISE_OTHER_GENERAL_MERCHANDISE",
      },
    });
    await setAutopilot(userId, "safe", { client, now: SOON });
    expect((await runTaxAutopilot(userId, { client, now: SOON })).recordsReminded).toBeGreaterThan(
      0,
    );
    expect((await runTaxAutopilot(userId, { client, now: SOON })).recordsReminded).toBe(0);
  });

  it("answers am I ready for an audit, and gives Claude the pack", async () => {
    const { userId } = await person("records-chat");
    const { reply } = await sendToJane(userId, "am I ready for an audit", { client, now: LINKED });
    expect(reply.body).toMatch(
      /^Your 2026 audit pack covers \$[\d,.]+ of deductions and credits, each tied to its sources:/,
    );
    expect(reply.body).toContain(
      "still needed: The charity's receipt for your gift to American Red Cross.",
    );
    const tool = JSON.parse(
      (await runChatTool(userId, "tax_records", {}, { client, now: LINKED })).content,
    );
    expect(tool.pack.every((i: { sources: number }) => i.sources > 0)).toBe(true);
  });
});
