import { randomBytes } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import type { PlaidApi } from "plaid";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));

import { linkDemoBank } from "@/lib/plaid/demo";
import { syncItem } from "@/lib/plaid/sync";
import { wholePicture } from "./whole-picture";
import { loadSnapshot } from "./snapshot";

// Books QA: every sample person's "am I OK?" opened with "Not quite: Card Payment Thank You,
// about $90.00, due Oct 25" because the chat counted every bill reminder as urgent. A bill
// reminder is urgent only when the balance could fall short that day (its own flag).

const url = process.env.TEST_DATABASE_URL;
const NOW = new Date("2026-10-16T15:00:00Z");

describe.runIf(url)("urgent alerts in the chat", { timeout: 120_000 }, () => {
  let client: PrismaClient;
  let userId: string;

  beforeAll(async () => {
    vi.stubEnv("TOKEN_ENCRYPTION_KEY", randomBytes(32).toString("base64"));
    vi.stubEnv("PLAID_CLIENT_ID", "");
    vi.stubEnv("PLAID_SECRET", "");
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
    const user = await client.user.create({
      data: { email: `urgent-${crypto.randomUUID()}@example.com` },
    });
    userId = user.id;
    const { itemId } = await linkDemoBank(userId, { client, now: NOW });
    const api = new Proxy({}, { get: () => () => Promise.reject(new Error("no Plaid")) });
    await syncItem(itemId, { client, api: api as PlaidApi, now: NOW });
  });
  afterAll(async () => {
    await client.user.deleteMany({ where: { id: userId } });
    await client.$disconnect();
    vi.unstubAllEnvs();
  });

  it("leaves a bill that's covered out of what needs the person now", async () => {
    await client.alert.createMany({
      data: [
        {
          userId,
          type: "bill_due",
          key: "covered:2026-10-18",
          title: "Card Payment Thank You, about $90.00, due Oct 18",
          body: "Expected from your past charges.",
          urgent: false,
          createdAt: NOW,
        },
        {
          userId,
          type: "bill_due",
          key: "short:2026-10-18",
          title: "Rent, about $1,450.00, due Oct 18",
          body: "Your balance could be about $40.00 that day.",
          urgent: true,
          createdAt: NOW,
        },
      ],
    });
    // The demo bank's own alerts (a large charge) are left as they are.
    await client.alert.deleteMany({ where: { userId, type: { not: "bill_due" } } });
    const snapshot = (await loadSnapshot(userId, { client, now: NOW }))!;
    expect(snapshot.urgentAlerts.map((a) => a.title)).toEqual([
      "Rent, about $1,450.00, due Oct 18",
    ]);
    expect(wholePicture(snapshot, [], "now").headline).toMatch(/^Not quite: Rent, about/);

    await client.alert.deleteMany({ where: { userId, key: "short:2026-10-18" } });
    const calm = (await loadSnapshot(userId, { client, now: NOW }))!;
    expect(calm.urgentAlerts.filter((a) => a.title.includes("due Oct 18"))).toEqual([]);
    expect(wholePicture(calm, [], "now").headline).not.toMatch(/Card Payment Thank You/);
  });
});
