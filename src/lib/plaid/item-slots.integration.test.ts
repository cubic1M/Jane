import { randomBytes } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import type { PlaidApi } from "plaid";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));
vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));

import { deleteAllData } from "@/lib/account-deletion";
import { track } from "@/lib/analytics";
import { encrypt } from "@/lib/crypto";
import { linkDemoBank } from "./demo";
import { itemSlotUse } from "./item-count";
import { LinkingClosedError, linkAvailability, reserveItemSlot } from "./item-slots";
import { createLinkToken, exchangePublicToken } from "./link";
import { removePlaidItem } from "./remove";

// Runs against a real, migrated Postgres (see src/detection/engine.integration.test.ts). Plaid is
// a stand-in throughout: nothing here reaches Plaid, and no test name or token is a real one.
const url = process.env.TEST_DATABASE_URL;

describe.runIf(url)("Plaid's Trial plan Items against a real database", () => {
  let client: PrismaClient;
  const made: string[] = [];
  const linkTokenCreate = vi.fn();
  const itemPublicTokenExchange = vi.fn();
  const itemRemove = vi.fn();
  const api = { linkTokenCreate, itemPublicTokenExchange, itemRemove } as unknown as PlaidApi;
  let nextItem = 0;

  // The counter is one row for the whole database, and other test files never touch it outside
  // Production, so each test starts it where it needs it.
  const setUsed = (used: number) =>
    client.plaidItemCounter.upsert({
      where: { id: "production" },
      create: { id: "production", used },
      update: { used },
    });
  const used = async () => (await itemSlotUse({ client })).used;

  async function person(id?: string) {
    const suffix = crypto.randomUUID();
    const user = await client.user.create({
      data: { id, email: `slots-${suffix}@example.com` },
    });
    made.push(user.id);
    return user.id;
  }

  const link = (userId: string) =>
    exchangePublicToken(userId, "public-production-test", "Made-up Bank", { client, api });

  beforeAll(() => {
    vi.stubEnv("TOKEN_ENCRYPTION_KEY", randomBytes(32).toString("base64"));
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  });

  afterAll(async () => {
    await client.user.deleteMany({ where: { id: { in: made } } });
    await client.plaidItemCounter.deleteMany({});
    await client.$disconnect();
    vi.unstubAllEnvs();
  });

  beforeEach(async () => {
    vi.stubEnv("PLAID_ENV", "production");
    vi.stubEnv("PLAID_TRIAL_ITEM_LIMIT", "");
    vi.stubEnv("PLAID_ITEMS_PER_PERSON", "");
    vi.stubEnv("DEMO_BANK", "1");
    vi.mocked(track).mockReset();
    linkTokenCreate.mockReset().mockResolvedValue({ data: { link_token: "link-production-1" } });
    itemRemove.mockReset().mockResolvedValue({ data: { request_id: "r" } });
    itemPublicTokenExchange.mockReset().mockImplementation(async () => ({
      data: { access_token: "access-production-made-up", item_id: `slots-item-${++nextItem}` },
    }));
    vi.spyOn(console, "warn").mockImplementation(() => {});
    await setUsed(0);
  });

  it("counts each Production Item, and the 11th is refused before any Plaid call", async () => {
    await setUsed(9);
    await link(await person());
    expect(await used()).toBe(10);

    const late = await person();
    itemPublicTokenExchange.mockClear();
    await expect(link(late)).rejects.toMatchObject({ reason: "full" });
    expect(itemPublicTokenExchange).not.toHaveBeenCalled();
    expect(await used()).toBe(10);
    // The refused person isn't marked as having used theirs, so an upgrade lets them link.
    expect(await client.plaidItemClaim.count({ where: { userId: late } })).toBe(0);
    await expect(createLinkToken(late, null, { client, api })).rejects.toBeInstanceOf(
      LinkingClosedError,
    );
    expect(linkTokenCreate).not.toHaveBeenCalled();
    expect(track).toHaveBeenCalledWith(late, "link_refused", { reason: "full", at: "link_token" });

    vi.stubEnv("PLAID_TRIAL_ITEM_LIMIT", "11");
    await expect(link(late)).resolves.toEqual(expect.any(String));
    expect(await used()).toBe(11);
  });

  it("lets one Item per person through, and a second falls back", async () => {
    const userId = await person();
    await link(userId);

    expect(await linkAvailability(userId, { client })).toEqual({ open: false, reason: "person" });
    await expect(link(userId)).rejects.toMatchObject({ reason: "person" });
    expect(await used()).toBe(1);

    vi.stubEnv("PLAID_ITEMS_PER_PERSON", "2");
    expect(await linkAvailability(userId, { client })).toEqual({ open: true });
  });

  it("never passes the limit with many people at once", async () => {
    await setUsed(7);
    const people = await Promise.all(Array.from({ length: 8 }, () => person()));
    const results = await Promise.allSettled(people.map((id) => link(id)));

    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(3);
    expect(await used()).toBe(10);
    expect(await client.plaidItem.count({ where: { userId: { in: people } } })).toBe(3);
    // Only the three who got in hold a claim.
    expect(await client.plaidItemClaim.count({ where: { userId: { in: people } } })).toBe(3);
  });

  it("gives one person in two tabs one Item", async () => {
    const userId = await person();
    const results = await Promise.allSettled([reserve(userId), reserve(userId), reserve(userId)]);

    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await used()).toBe(1);
    function reserve(id: string) {
      return reserveItemSlot(id, { client });
    }
  });

  it("doesn't take a slot for a Link token: abandoning Link costs nothing", async () => {
    const userId = await person();
    await createLinkToken(userId, null, { client, api });
    expect(await used()).toBe(0);
    expect(await client.plaidItemClaim.count({ where: { userId } })).toBe(0);
  });

  it("always lets a linked bank sign in again, at either limit", async () => {
    const userId = await person();
    const itemId = await link(userId);
    await setUsed(10);
    await client.plaidItem.update({
      where: { id: itemId },
      data: { accessTokenEncrypted: encrypt("access-production-made-up") },
    });

    await expect(createLinkToken(userId, itemId, { client, api })).resolves.toBe(
      "link-production-1",
    );
    expect(linkTokenCreate.mock.calls[0][0].access_token).toBe("access-production-made-up");
    expect(await used()).toBe(10);
  });

  it("keeps the slot when the Item is removed or the account deleted", async () => {
    const userId = await person();
    const itemId = await link(userId);
    await removePlaidItem(userId, itemId, "user_disconnected", { client, api });

    expect(await client.plaidItem.count({ where: { userId } })).toBe(0);
    expect(await used()).toBe(1);
    // And removing it doesn't let the same person spend another.
    expect(await linkAvailability(userId, { client })).toEqual({ open: false, reason: "person" });

    await deleteAllData(userId, { client, api });
    expect(await client.user.count({ where: { id: userId } })).toBe(0);
    expect(await client.plaidItemClaim.count({ where: { userId } })).toBe(0);
    expect(await used()).toBe(1);
  });

  it("gives the slot back when Plaid refused the exchange, and only then", async () => {
    const refused = await person();
    itemPublicTokenExchange.mockRejectedValueOnce({
      response: { status: 400, data: { error_code: "INVALID_PUBLIC_TOKEN" } },
    });
    await expect(link(refused)).rejects.toMatchObject({ code: "INVALID_PUBLIC_TOKEN" });
    expect(await used()).toBe(0);
    expect(await linkAvailability(refused, { client })).toEqual({ open: true });

    // No answer: Plaid may have made a token, so it counts.
    const unknown = await person();
    itemPublicTokenExchange.mockRejectedValueOnce({ code: "ECONNRESET" });
    await expect(link(unknown)).rejects.toMatchObject({ code: "NETWORK_ECONNRESET" });
    expect(await used()).toBe(1);

    // The same for a failure of Plaid's own.
    const failed = await person();
    itemPublicTokenExchange.mockRejectedValueOnce({
      response: { status: 500, data: { error_code: "INTERNAL_SERVER_ERROR" } },
    });
    await expect(link(failed)).rejects.toMatchObject({ status: 500 });
    expect(await used()).toBe(2);
  });

  it("doesn't count a retry that gets the same Item back", async () => {
    vi.stubEnv("PLAID_ITEMS_PER_PERSON", "2");
    const userId = await person();
    itemPublicTokenExchange.mockImplementation(async () => ({
      data: { access_token: "access-production-made-up", item_id: `slots-retry-${userId}` },
    }));
    const first = await link(userId);
    await expect(link(userId)).resolves.toBe(first);
    expect(await used()).toBe(1);
    expect(await client.plaidItemClaim.count({ where: { userId } })).toBe(1);
    expect(await client.plaidItem.count({ where: { userId } })).toBe(1);
  });

  it("never counts in Sandbox", async () => {
    vi.stubEnv("PLAID_ENV", "sandbox");
    await setUsed(10);
    const userId = await person();

    expect(await linkAvailability(userId, { client })).toEqual({ open: true });
    await createLinkToken(userId, null, { client, api });
    await link(userId);
    await link(userId);

    expect(await used()).toBe(10);
    expect(await client.plaidItemClaim.count({ where: { userId } })).toBe(0);
    expect(await client.plaidItem.count({ where: { userId } })).toBe(2);
  });

  it("never counts the demo bank, and it doesn't use up the person's own", async () => {
    await setUsed(10);
    const userId = await person();
    await linkDemoBank(userId, { client });
    expect(await used()).toBe(10);

    await setUsed(3);
    expect(await linkAvailability(userId, { client })).toEqual({ open: true });
    // Should an exchange ever answer with a demo Item, its slot goes straight back.
    itemPublicTokenExchange.mockResolvedValueOnce({
      data: { access_token: "demo:made-up", item_id: `demo-${userId}-exchange` },
    });
    await link(userId);
    expect(await used()).toBe(3);
    expect(await client.plaidItemClaim.count({ where: { userId } })).toBe(0);
  });

  it("keeps trial people off real banks in Production, and off the count", async () => {
    const trial = await person(`trial_slots${randomBytes(6).toString("hex")}`);
    expect(await linkAvailability(trial, { client })).toEqual({ open: false, reason: "trial" });
    await expect(link(trial)).rejects.toMatchObject({ reason: "trial" });
    expect(await used()).toBe(0);
    await linkDemoBank(trial, { client });
    expect(await used()).toBe(0);

    vi.stubEnv("PLAID_ENV", "sandbox");
    expect(await linkAvailability(trial, { client })).toEqual({ open: true });
  });

  it("logs a line from 8 of 10", async () => {
    await setUsed(6);
    await link(await person());
    expect(console.warn).not.toHaveBeenCalled();
    await link(await person());
    expect(console.warn).toHaveBeenCalledWith("Plaid Production Items are nearly used", {
      used: 8,
      limit: 10,
    });
  });

  it("keeps one person's claim from counting against another", async () => {
    const [a, b] = [await person(), await person()];
    await link(a);
    expect(await linkAvailability(b, { client })).toEqual({ open: true });
  });
});
