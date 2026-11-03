import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn() }));

import { sharedReadFor } from "./db-scoped";
import {
  acceptInvite,
  householdOf,
  invitePartner,
  leaveHousehold,
  setAccountSharing,
} from "./household";

// Runs against a real, migrated Postgres (see src/detection/engine.integration.test.ts).
const url = process.env.TEST_DATABASE_URL;
const NOW = new Date("2026-10-15T12:00:00Z");

describe.runIf(url)("households against a real database", () => {
  let client: PrismaClient;
  const created: string[] = [];

  async function person(name: string) {
    const email = `${name}-${crypto.randomUUID()}@example.com`;
    const user = await client.user.create({ data: { email } });
    created.push(user.id);
    const account = (accountName: string) =>
      client.account.create({
        data: {
          userId: user.id,
          source: "csv",
          name: accountName,
          type: "depository",
          currentBalanceCents: 5_000,
        },
      });
    const joint = await account(`${name} joint checking`);
    const own = await account(`${name} private savings`);
    const tx = await client.transaction.create({
      data: {
        userId: user.id,
        accountId: joint.id,
        source: "csv",
        dedupeKey: `${name}-1`,
        date: new Date("2026-10-01"),
        amountCents: 1_549,
        description: "NETFLIX.COM",
      },
    });
    const finding = (key: string, evidence: object, status: "new" | "approved" = "new") =>
      client.finding.create({
        data: {
          userId: user.id,
          type: "subscription_review",
          key,
          title: `${name} ${key}`,
          annualSavingsCents: 18_588,
          confidence: "high",
          evidence,
          status,
        },
      });
    await finding("on-joint", { charges: [{ id: tx.id }] });
    await finding("on-private", { accountId: own.id });
    await finding("decided", { charges: [{ id: tx.id }] }, "approved");
    return { id: user.id, email, joint, own };
  }

  async function household() {
    const a = await person("alex");
    const b = await person("blair");
    const { token } = await invitePartner(a, b.email, { client, now: NOW });
    await acceptInvite(b, token, { client, now: NOW });
    return { a, b };
  }

  beforeAll(() => {
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  });
  afterAll(async () => {
    await client.user.deleteMany({ where: { id: { in: created } } });
    await client.$disconnect();
  });

  it("lets the invited partner join with the link", async () => {
    const { a, b } = await household();
    const h = await householdOf(a.id, { client });
    expect(h?.members.map((m) => m.userId).sort()).toEqual([a.id, b.id].sort());
  });

  it("shows a partner only shared accounts, and undecided findings on them", async () => {
    const { a, b } = await household();
    await setAccountSharing(a.id, a.joint.id, true, { client });

    const view = await sharedReadFor(b.id, client);

    expect(view.accounts.map((x) => x.id)).toEqual([a.joint.id]);
    expect((await view.transactions()).map((t) => t.accountId)).toEqual([a.joint.id]);
    // Not the finding on the private account, and not the one Alex already decided on.
    expect((await view.findings()).map((f) => f.title)).toEqual(["alex on-joint"]);
    expect(JSON.stringify(view)).not.toMatch(/private savings|decision/i);
  });

  it("is read-only: the shared view has no way to write", async () => {
    const { b } = await household();
    const view = await sharedReadFor(b.id, client);
    // Spec step 198 adds the policies a partner chose to share.
    expect(Object.keys(view).sort()).toEqual([
      "accounts",
      "findings",
      "partners",
      "policies",
      "transactions",
    ]);
    expect(Object.isFrozen(view)).toBe(true);
  });

  it("won't let someone share an account that isn't theirs", async () => {
    const { a, b } = await household();
    expect(await setAccountSharing(b.id, a.own.id, true, { client })).toBe(false);
    expect(
      (await client.account.findUniqueOrThrow({ where: { id: a.own.id } })).sharedWithHousehold,
    ).toBe(false);
  });

  it("removes access the moment someone leaves", async () => {
    const { a, b } = await household();
    await setAccountSharing(a.id, a.joint.id, true, { client });
    expect((await sharedReadFor(b.id, client)).accounts).toHaveLength(1);

    await leaveHousehold(b.id, { client });

    const after = await sharedReadFor(b.id, client);
    expect(after.accounts).toEqual([]);
    expect(await after.findings()).toEqual([]);
    expect(await after.transactions()).toEqual([]);
    expect((await sharedReadFor(a.id, client)).partners).toEqual([]);
  });

  it("only accepts the invited email, once, before it expires", async () => {
    const a = await person("casey");
    const b = await person("drew");
    const stranger = await person("eve");
    const { token } = await invitePartner(a, b.email, { client, now: NOW });

    await expect(acceptInvite(stranger, token, { client, now: NOW })).rejects.toThrow(
      /This invite is for/,
    );
    await expect(
      acceptInvite(b, token, { client, now: new Date(NOW.getTime() + 8 * 24 * 60 * 60 * 1000) }),
    ).rejects.toThrow(/expired/);
    await acceptInvite(b, token, { client, now: NOW });
    await expect(acceptInvite(b, token, { client, now: NOW })).rejects.toThrow(/expired|used/);
  });

  it("refuses an address too long to be one before any pattern reads it", async () => {
    const { a } = await household();
    const started = performance.now();
    await expect(invitePartner(a, `${"a@".repeat(50_000)}.`, { client, now: NOW })).rejects.toThrow(
      /partner's email/,
    );
    expect(performance.now() - started).toBeLessThan(2000);
  });

  // Sharing stayed on after leaving, so the next person to join saw it at once, though the join page
  // says "Nothing of yours is shared until you choose". Each person's change is to their own rows: the
  // access proof refuses a partner writing to the other's.
  it("ends each person's choice to share at their own step, and never the other's", async () => {
    const { a, b } = await household();
    const shared = { sharedWithHousehold: true };
    const stillShared = (userId: string) =>
      client.account.count({ where: { userId, sharedWithHousehold: true } });
    await client.account.updateMany({ where: { userId: { in: [a.id, b.id] } }, data: shared });

    await leaveHousehold(b.id, { client });
    expect(await stillShared(b.id)).toBe(0);
    expect(await stillShared(a.id)).toBeGreaterThan(0);

    // The one who stayed invites someone new: their old sharing ends before anyone can join.
    await client.account.updateMany({ where: { userId: b.id }, data: shared });
    const { token } = await invitePartner(a, b.email, { client, now: NOW });
    expect(await stillShared(a.id)).toBe(0);

    // And whoever joins starts with nothing shared.
    await acceptInvite(b, token, { client, now: NOW });
    expect(await stillShared(b.id)).toBe(0);
  });

  it("keeps households to two people", async () => {
    const { a } = await household();
    await expect(invitePartner(a, "third@example.com", { client, now: NOW })).rejects.toThrow(
      /full/,
    );
  });
});
