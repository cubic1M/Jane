import { PrismaPg } from "@prisma/adapter-pg";
import type { PlaidApi } from "plaid";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));

import { DWOLLA_SANDBOX } from "@/config/money-movement";
import { stubTestKeys } from "@/lib/__fixtures__/env";
import { linkDemoBank } from "@/lib/plaid/demo";
import { syncItem } from "@/lib/plaid/sync";
import { moneyPartnerFor } from "../partner";
import { TransferError, cancelTransfer, scheduleTransfer, settleTransfers } from "../transfers";
import { dwollaSandboxHttp } from "./api";
import { dwollaSandboxPartner } from "./partner";

// Dwolla's Sandbox behind Jane's own transfers, against a real, migrated Postgres and a fake Dwolla
// (no network): scheduling and the one-day undo stay in Jane's queue, the day's settle hands it to
// Dwolla once, a transfer Dwolla has processed is completed, and nobody's partner is ever Dwolla.

const url = process.env.TEST_DATABASE_URL;
const LINKED = new Date("2026-10-16T15:00:00Z");
const DAY_OF = new Date("2026-10-17T15:00:00Z");
const DAY_AFTER = new Date("2026-10-18T15:00:00Z");
const ENV = {
  [DWOLLA_SANDBOX.keyEnv]: "test-dwolla-key",
  [DWOLLA_SANDBOX.secretEnv]: "test-dwolla-secret",
};
const fs = (n: number) =>
  `${DWOLLA_SANDBOX.base}/funding-sources/00000000-0000-4000-8000-00000000000${n}`;

// Dwolla's Sandbox: each new transfer pending until `processed` lists it.
function fakeDwolla() {
  const made: string[] = [];
  const processed = new Set<string>();
  const send = vi.fn(async (to: string, init?: RequestInit) => {
    if (to.endsWith("/token")) return Response.json({ access_token: "t", expires_in: 3600 });
    if (to.endsWith("/transfers")) {
      const id = `11111111-1111-4111-8111-${String(made.length).padStart(12, "0")}`;
      made.push(id);
      return new Response(null, {
        status: 201,
        headers: { location: `${DWOLLA_SANDBOX.base}/transfers/${id}` },
      });
    }
    const id = to.split("/").pop()!;
    if (init?.method === "POST")
      return new Response(null, { status: processed.has(id) ? 400 : 200 });
    return Response.json({ id, status: processed.has(id) ? "processed" : "pending" });
  });
  return { send, made, processed };
}

describe.runIf(url)("Dwolla's Sandbox behind Jane's transfers", { timeout: 60_000 }, () => {
  let client: PrismaClient;
  let userId: string;
  let checking: string;
  let savings: string;
  const dwolla = fakeDwolla();
  let partner: ReturnType<typeof dwollaSandboxPartner>;
  const api = new Proxy(
    {},
    {
      get: () => () => {
        throw new Error("no Plaid");
      },
    },
  ) as PlaidApi;

  beforeAll(async () => {
    stubTestKeys();
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
    const user = await client.user.create({
      data: { email: `dwolla-${crypto.randomUUID()}@example.com` },
    });
    userId = user.id;
    const { itemId } = await linkDemoBank(userId, { client, now: LINKED });
    await syncItem(itemId, { client, api, now: LINKED });
    const accounts = await client.account.findMany({
      where: { userId, type: "depository" },
      select: { id: true, subtype: true },
    });
    checking = accounts.find((a) => a.subtype === "checking")!.id;
    savings = accounts.find((a) => a.subtype === "savings")!.id;
    const sources = { [checking]: fs(1), [savings]: fs(2) };
    partner = dwollaSandboxPartner({
      fundingSource: (id) => sources[id] ?? null,
      api: dwollaSandboxHttp({ env: ENV, fetch: dwolla.send as never }),
    });
  });
  afterAll(async () => {
    await client.user.deleteMany({ where: { id: userId } });
    await client.$disconnect();
    vi.unstubAllEnvs();
  });

  const move = (amountCents: number) =>
    scheduleTransfer(
      userId,
      {
        fromAccountId: checking,
        toAccountId: savings,
        toName: "Savings",
        amountCents,
        purpose: "cash",
        sector: "goals",
      },
      "person",
      { client, now: LINKED, partner },
    );
  const status = async (id: string) =>
    await client.moneyTransfer.findUniqueOrThrow({
      where: { id },
      select: { status: true, partnerRef: true },
    });

  it("keeps a scheduled transfer and its undo in Jane, telling Dwolla nothing", async () => {
    const { id } = await move(1_000);
    expect((await status(id)).partnerRef).toMatch(/^JANEQ-/);
    await cancelTransfer(userId, id, { client, now: LINKED, partner });
    expect((await status(id)).status).toBe("cancelled");
    expect(dwolla.send).not.toHaveBeenCalled();
  });

  it("hands it to Dwolla on its day, once, and completes it when Dwolla has processed it", async () => {
    const { id } = await move(2_500);
    expect(await settleTransfers(userId, { client, now: DAY_OF, partner })).toBe(0);
    expect(dwolla.made).toHaveLength(1);
    const sent = await status(id);
    expect(sent).toEqual({ status: "pending", partnerRef: `dwolla:${dwolla.made[0]}` });
    // Still pending at Dwolla: settling again doesn't send a second one.
    expect(await settleTransfers(userId, { client, now: DAY_OF, partner })).toBe(0);
    expect(dwolla.made).toHaveLength(1);
    const body = JSON.parse(
      String(dwolla.send.mock.calls.find(([u]) => String(u).endsWith("/transfers"))![1]!.body),
    );
    expect(body.amount).toEqual({ value: "25.00", currency: "USD" });
    dwolla.processed.add(dwolla.made[0]!);
    expect(await settleTransfers(userId, { client, now: DAY_AFTER, partner })).toBe(1);
    expect((await status(id)).status).toBe("completed");
  });

  it("can't be undone once Dwolla says processing began", async () => {
    const { id } = await move(3_000);
    await settleTransfers(userId, { client, now: DAY_OF, partner });
    dwolla.processed.add(dwolla.made.at(-1)!);
    await expect(
      cancelTransfer(userId, id, { client, now: DAY_OF, partner }),
    ).rejects.toBeInstanceOf(TransferError);
    expect((await status(id)).status).toBe("pending");
  });

  it("is nobody's partner: moneyPartnerFor never gives Dwolla", async () => {
    const found = await moneyPartnerFor(userId, { client });
    expect(found?.name).not.toBe(DWOLLA_SANDBOX.name);
    expect(found?.release).toBeUndefined();
  });
});
