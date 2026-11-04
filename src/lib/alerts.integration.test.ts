import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ALERT_EMAILS_PER_DAY, ALERTS_RECENT_DAYS } from "@/config/alerts";
import type { AlertCandidate } from "@/detection/alerts";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));

import {
  markAlertsRead,
  newestUnreadAlerts,
  raiseAlerts,
  recentAlerts,
  unreadAlertCount,
} from "./alerts";

// Runs against a real, migrated Postgres (see engine.integration.test.ts).
const url = process.env.TEST_DATABASE_URL;

const NOW = new Date("2026-10-15T12:00:00Z");
const HOUR = 60 * 60 * 1000;

const alert = (overrides: Partial<AlertCandidate> = {}): AlertCandidate => ({
  type: "large_charge",
  key: `tx_${crypto.randomUUID()}`,
  title: "$1,200.00 at Best Electronics",
  body: "On your card.",
  confidence: { percent: 82, reason: "12 charges on the account in 12 months of data" },
  ...overrides,
});

describe.runIf(url)("raiseAlerts against a real database", () => {
  let client: PrismaClient;
  const ids: string[] = [];
  const send = vi.fn();

  async function person(alertPrefs: object = {}) {
    const user = await client.user.create({
      data: { email: `alerts-${crypto.randomUUID()}@example.com`, alertPrefs },
    });
    ids.push(user.id);
    return user;
  }
  const alertsOf = (userId: string) =>
    client.alert.findMany({ where: { userId }, orderBy: { createdAt: "asc" } });

  beforeAll(() => {
    vi.stubEnv("AUTH_SECRET", "test-secret");
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  });

  beforeEach(() => {
    send.mockReset().mockResolvedValue(undefined);
  });

  afterAll(async () => {
    await client.user.deleteMany({ where: { id: { in: ids } } });
    await client.$disconnect();
    vi.unstubAllEnvs();
  });

  it("stores each event once, however many times it is raised", async () => {
    const user = await person();
    const fee = alert({ type: "fee_charged", key: "tx_fee_1" });

    expect(await raiseAlerts(user.id, [fee], { client, now: NOW, send })).toMatchObject({
      raised: 1,
    });
    expect(await raiseAlerts(user.id, [fee], { client, now: NOW, send })).toMatchObject({
      raised: 0,
    });

    const rows = await alertsOf(user.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ type: "fee_charged", urgent: false, emailedAt: null });
    expect(send).not.toHaveBeenCalled();
  });

  it("keeps each alert's confidence, and the alerts list shows it", async () => {
    const user = await person();
    await raiseAlerts(user.id, [alert({ type: "fee_charged", key: "tx_fee_c" })], {
      client,
      now: NOW,
      send,
    });
    const [row] = await alertsOf(user.id);
    expect(row).toMatchObject({
      confidencePercent: 82,
      confidenceReason: "12 charges on the account in 12 months of data",
    });
    const [shown] = await newestUnreadAlerts(user.id, { client, limit: 5 });
    expect(shown).toMatchObject({ confidencePercent: 82 });
  });

  it("raises an estimated-payment reminder once per date, in the app only", async () => {
    const user = await person();
    const reminder = alert({ type: "estimated_tax", key: "2027-01-15" });
    const later = new Date(NOW.getTime() + 24 * HOUR);
    await raiseAlerts(user.id, [reminder], { client, now: NOW, send });
    await raiseAlerts(user.id, [reminder], { client, now: later, send });
    await raiseAlerts(user.id, [alert({ type: "estimated_tax", key: "2027-04-15" })], {
      client,
      now: later,
      send,
    });

    const rows = await alertsOf(user.id);
    expect(rows.map((r) => r.key)).toEqual(["2027-01-15", "2027-04-15"]);
    expect(rows.every((r) => !r.urgent)).toBe(true);
    expect(send).not.toHaveBeenCalled();
  });

  it("emails an urgent alert right away, with an unsubscribe header", async () => {
    const user = await person();

    expect(await raiseAlerts(user.id, [alert()], { client, now: NOW, send })).toEqual({
      raised: 1,
      emailed: 1,
    });

    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        to: user.email,
        subject: "Jane: Unusually large charge",
        headers: expect.objectContaining({
          "List-Unsubscribe": expect.stringContaining("what=alerts"),
        }),
      }),
    );
    expect((await alertsOf(user.id))[0].emailedAt).toEqual(NOW);
    expect(send.mock.calls[0][0].text).toMatch(/See your alerts: \S+\/jane#alerts$/m);
  });

  it("never emails sample figures to someone whose only bank is the demo bank", async () => {
    const user = await person();
    await client.plaidItem.create({
      data: {
        userId: user.id,
        plaidItemId: `demo-${crypto.randomUUID()}`,
        accessTokenEncrypted: "x",
      },
    });

    expect(await raiseAlerts(user.id, [alert()], { client, now: NOW, send })).toEqual({
      raised: 1,
      emailed: 0,
    });
    expect(send).not.toHaveBeenCalled();
    expect((await alertsOf(user.id))[0].emailedAt).toBeNull();
  });

  it("marks only what was seen as read, and keeps it listed for a while", async () => {
    const user = await person();
    const raised = ["a", "b", "c", "d"].map((key) => alert({ type: "fee_charged", key }));
    await raiseAlerts(user.id, raised, { client, now: NOW, send });
    const rows = await alertsOf(user.id);

    await markAlertsRead(user.id, { client, now: NOW, ids: rows.slice(0, 3).map((r) => r.id) });
    expect(await unreadAlertCount(user.id, { client })).toBe(1);

    const listed = await recentAlerts(user.id, { client, now: NOW, limit: 4 });
    expect(listed).toHaveLength(4);
    // The one still new comes first.
    expect(listed[0].id).toBe(rows[3].id);

    const later = new Date(NOW.getTime() + (ALERTS_RECENT_DAYS + 1) * 86_400_000);
    const old = await recentAlerts(user.id, { client, now: later, limit: 4 });
    expect(old.map((a) => a.id)).toEqual([rows[3].id]);
  });

  it("emails a bill reminder only when it's urgent", async () => {
    const user = await person();
    await raiseAlerts(
      user.id,
      [
        alert({ type: "bill_due", key: "Geico:2026-10-17", urgent: false }),
        alert({ type: "bill_due", key: "Rent:2026-10-18", urgent: true }),
      ],
      { client, now: NOW, send },
    );

    const rows = await alertsOf(user.id);
    expect(rows.map((r) => [r.key, r.urgent, r.emailedAt !== null])).toEqual(
      expect.arrayContaining([
        ["Geico:2026-10-17", false, false],
        ["Rent:2026-10-18", true, true],
      ]),
    );
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("respects preferences: off is never stored, in-app is never emailed", async () => {
    const user = await person({ large_charge: "off", duplicate_charge: "app" });

    await raiseAlerts(user.id, [alert(), alert({ type: "duplicate_charge" })], {
      client,
      now: NOW,
      send,
    });

    const rows = await alertsOf(user.id);
    expect(rows.map((r) => r.type)).toEqual(["duplicate_charge"]);
    expect(rows[0].emailedAt).toBeNull();
    expect(send).not.toHaveBeenCalled();
  });

  it("holds the daily email cap across scans", async () => {
    const user = await person();
    const many = Array.from({ length: ALERT_EMAILS_PER_DAY + 2 }, () => alert());

    await raiseAlerts(user.id, many.slice(0, 2), { client, now: NOW, send });
    await raiseAlerts(user.id, many.slice(2), {
      client,
      now: new Date(NOW.getTime() + HOUR),
      send,
    });

    expect(send).toHaveBeenCalledTimes(ALERT_EMAILS_PER_DAY);
    const rows = await alertsOf(user.id);
    expect(rows.filter((r) => r.emailedAt)).toHaveLength(ALERT_EMAILS_PER_DAY);

    // A day later there's room again, but those alerts are old news: they wait for the
    // weekly email rather than arriving a day late.
    await raiseAlerts(user.id, [], { client, now: new Date(NOW.getTime() + 25 * HOUR), send });
    expect(send).toHaveBeenCalledTimes(ALERT_EMAILS_PER_DAY);
  });

  it("leaves a failed email for the weekly email instead", async () => {
    const user = await person();
    send.mockRejectedValue(new Error("Resend is down"));
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    expect(await raiseAlerts(user.id, [alert()], { client, now: NOW, send })).toEqual({
      raised: 1,
      emailed: 0,
    });

    expect((await alertsOf(user.id))[0].emailedAt).toBeNull();
    error.mockRestore();
  });

  it("raises nothing for a deleted account", async () => {
    const user = await person();
    await client.user.update({ where: { id: user.id }, data: { deletedAt: NOW } });

    expect(await raiseAlerts(user.id, [alert()], { client, now: NOW, send })).toEqual({
      raised: 0,
      emailed: 0,
    });
  });

  describe("with phone notifications set up", () => {
    const push = vi.fn();
    beforeEach(() => {
      vi.stubEnv("VAPID_PUBLIC_KEY", "pub");
      vi.stubEnv("VAPID_PRIVATE_KEY", "priv");
      vi.stubEnv("VAPID_SUBJECT", "mailto:team@example.com");
      push.mockReset();
    });

    async function subscribed() {
      const user = await person();
      await client.pushSubscription.create({
        data: {
          userId: user.id,
          endpoint: `https://push.example/${user.id}`,
          p256dh: "p",
          auth: "a",
        },
      });
      return user;
    }

    it("sends urgent alerts to the phone instead of email", async () => {
      push.mockResolvedValue(1);
      const user = await subscribed();

      expect(await raiseAlerts(user.id, [alert()], { client, now: NOW, send, push })).toEqual({
        raised: 1,
        emailed: 1,
      });
      expect(push).toHaveBeenCalledWith(
        user.id,
        expect.objectContaining({
          title: "Jane: Unusually large charge",
          body: "Open Jane to see it.",
          url: "/jane#alerts",
        }),
        { client },
      );
      expect(send).not.toHaveBeenCalled();
    });

    it("emails when no device takes it, and when the person has no device", async () => {
      push.mockResolvedValue(0);
      const user = await subscribed();
      await raiseAlerts(user.id, [alert()], { client, now: NOW, send, push });
      expect(send).toHaveBeenCalledTimes(1);

      const plain = await person();
      push.mockClear();
      await raiseAlerts(plain.id, [alert()], { client, now: NOW, send, push });
      expect(push).not.toHaveBeenCalled();
      expect(send).toHaveBeenCalledTimes(2);
    });
  });
});
