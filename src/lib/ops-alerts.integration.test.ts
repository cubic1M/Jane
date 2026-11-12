import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));

import { OPS_ALERT_MINUTES, OPS_EVENTS_PER_KIND_HOUR } from "@/config/ops-alerts";
import { opsCounts, recordOpsEvent, safeCode, sendOpsDigest } from "./ops-alerts";

// The founders' alarms for a closed beta: urgent ones at once (at most once an hour each), the
// rest in one daily email, nothing on a quiet day, and nothing about anyone in either.
const url = process.env.TEST_DATABASE_URL;
// Past every other test file's clock: the events table and the notices are shared.
const NOW = new Date("2038-04-10T12:00:00Z");
const MINUTE = 60_000;
const at = (minutes: number) => new Date(NOW.getTime() + minutes * MINUTE);

type Sent = { to: string; subject: string; text: string; html: string };

describe.runIf(url)("ops alerts", () => {
  let client: PrismaClient;
  const send = vi.fn(async (_email: Sent) => undefined);
  const sent = () => send.mock.calls.map(([m]) => m);
  const clear = async () => {
    await client.opsEvent.deleteMany({ where: { createdAt: { gte: at(-3 * 24 * 60) } } });
    await client.healthNotice.deleteMany({
      where: { OR: [{ key: { startsWith: "ops:" } }, { key: { startsWith: "ops-digest:2038" } }] },
    });
  };

  beforeAll(() => {
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
    vi.stubEnv("ADMIN_EMAILS", "a@example.test, b@example.test");
  });
  beforeEach(async () => {
    send.mockClear();
    await clear();
  });
  afterAll(async () => {
    await clear();
    vi.unstubAllEnvs();
    await client.$disconnect();
  });

  it("emails the team at once when sign-in emails fail, then waits an hour", async () => {
    const first = await recordOpsEvent("sign_in_email_failed", {
      code: "RESEND_403",
      client,
      now: NOW,
      send,
    });
    expect(first).toEqual({ recorded: true, emailed: true });
    await recordOpsEvent("sign_in_email_failed", { client, now: at(5), send });
    expect(sent().map((m) => m.to)).toEqual(["a@example.test", "b@example.test"]);
    expect(sent()[0].subject).toBe("Jane: sign-in emails didn't send");

    const later = await recordOpsEvent("sign_in_email_failed", {
      client,
      now: at(OPS_ALERT_MINUTES + 1),
      send,
    });
    expect(later.emailed).toBe(true);
    expect(sent()).toHaveLength(4);
    expect(sent()[2].text).toContain("2 sign-in emails didn't send in the last hour");
  });

  it("keeps a bank breaking for the daily email, not an email at once", async () => {
    expect(
      await recordOpsEvent("bank_connection_broken", {
        code: "ITEM_LOGIN_REQUIRED",
        client,
        now: NOW,
        send,
      }),
    ).toEqual({ recorded: true, emailed: false });
    expect(send).not.toHaveBeenCalled();
  });

  it("never counts a trial person (sample data)", async () => {
    const result = await recordOpsEvent("plaid_sync_failed", {
      userId: "trial_abc",
      client,
      now: NOW,
      send,
    });
    expect(result.recorded).toBe(false);
    expect(await client.opsEvent.count({ where: { createdAt: NOW } })).toBe(0);
  });

  it("keeps only a code: a message, an address or an id is dropped", async () => {
    expect(safeCode("ITEM_LOGIN_REQUIRED")).toBe("ITEM_LOGIN_REQUIRED");
    expect(safeCode("someone@example.com")).toBeNull();
    expect(safeCode("Resend rejected the email (403)")).toBeNull();
    await recordOpsEvent("plaid_sync_failed", { code: "a@b.c", client, now: NOW, send });
    const row = await client.opsEvent.findFirstOrThrow({ where: { createdAt: NOW } });
    expect(row).toMatchObject({ kind: "plaid_sync_failed", code: null });
  });

  it("stops recording a flood: a burst of forged webhooks can't fill the table", async () => {
    await client.opsEvent.createMany({
      data: Array.from({ length: OPS_EVENTS_PER_KIND_HOUR }, () => ({
        kind: "plaid_webhook_unverified",
        createdAt: at(-1),
      })),
    });
    const result = await recordOpsEvent("plaid_webhook_unverified", { client, now: NOW, send });
    expect(result.recorded).toBe(false);
  });

  it("sends one daily email with the day's counts and codes, and nothing on a quiet day", async () => {
    expect(await sendOpsDigest({ client, now: NOW, send })).toBe(0);
    expect(send).not.toHaveBeenCalled();

    for (const code of ["INSTITUTION_DOWN", "INSTITUTION_DOWN", "RATE_LIMIT"]) {
      await client.opsEvent.create({
        data: { kind: "plaid_sync_failed", code, createdAt: at(-60) },
      });
    }
    await client.opsEvent.create({
      data: { kind: "bank_connection_broken", code: "ITEM_LOGIN_REQUIRED", createdAt: at(-30) },
    });
    // Older than a day: not in today's email.
    await client.opsEvent.create({ data: { kind: "plaid_sync_failed", createdAt: at(-25 * 60) } });

    expect(await sendOpsDigest({ client, now: NOW, send })).toBe(4);
    expect(await sendOpsDigest({ client, now: at(60), send })).toBe(0);
    expect(sent()).toHaveLength(2);
    const [mail] = sent();
    expect(mail.subject).toBe(
      "Jane, last 24 hours: 3 Plaid syncs failed (INSTITUTION_DOWN ×2, RATE_LIMIT ×1) and 1 more",
    );
    expect(mail.text).toContain(
      "- 1 bank connections broke (person asked to sign in) (ITEM_LOGIN_REQUIRED ×1)",
    );
  });

  it("counts by kind for /admin/health", async () => {
    await recordOpsEvent("plaid_webhook_failed", { client, now: at(-10), send });
    const counts = await opsCounts(at(-60), { client, now: NOW });
    expect(counts).toEqual([
      { kind: "plaid_webhook_failed", label: "Plaid webhooks failed", count: 1, codes: [] },
    ]);
  });
});
