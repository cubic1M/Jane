import { randomBytes } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { PAYMENT_ROLLOUT } from "@/config/money-rollout";
import { REAL_MONEY_MOVEMENT } from "@/config/money-movement";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));

import { linkDemoBank } from "@/lib/plaid/demo";
import { syncItem } from "@/lib/plaid/sync";
import { setActsStopped } from "@/lib/permission/stop";
import type { PaymentAdapter, PaymentStatus } from "./adapters/types";
import { moneyPartnerFor, standInPartner } from "./partner";
import { PREPARED_PARTNER, preparedPartner, remindPrepared } from "./prepared";
import { dispatchDue, isQueued, queuedPartner, routedAdapter } from "./queue";
import { cancelTransfer, scheduleTransfer, settleTransfers } from "./transfers";

// Stage 3 against a real, migrated Postgres, with a mock vendor. Nothing reaches a real API, and no
// code picks a real vendor: REAL_MONEY_MOVEMENT is false.

const url = process.env.TEST_DATABASE_URL;
const NOW = new Date("2026-10-18T15:00:00Z");
const RUN_DAY = new Date("2026-10-19T15:00:00Z");

const fakeVendor = (status: PaymentStatus = "settled"): PaymentAdapter & { sent: string[] } => {
  const sent: string[] = [];
  return {
    name: "fake",
    sent,
    async send(_request, { key }) {
      sent.push(key);
      return { partnerRef: `sent-${sent.length}` };
    },
    async cancel() {
      return true;
    },
    async status() {
      return status;
    },
  };
};

describe.runIf(url)("Stage 3", { timeout: 120_000 }, () => {
  let client: PrismaClient;
  const created: string[] = [];
  const options = () => ({ client, now: NOW });

  beforeAll(() => {
    vi.stubEnv("TOKEN_ENCRYPTION_KEY", randomBytes(32).toString("base64"));
    vi.stubEnv("PLAID_CLIENT_ID", "");
    vi.stubEnv("PLAID_SECRET", "");
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url! }) });
  });
  afterEach(() => vi.stubEnv("PAYMENT_REHEARSAL", ""));
  afterAll(async () => {
    await client.user.deleteMany({ where: { id: { in: created } } });
    await client.$disconnect();
    vi.unstubAllEnvs();
  });

  async function person(kind: "demo" | "real") {
    const user = await client.user.create({
      data: { email: `stage3-${crypto.randomUUID()}@example.com` },
    });
    created.push(user.id);
    if (kind === "demo") {
      const { itemId } = await linkDemoBank(user.id, { client, now: NOW });
      await syncItem(itemId, { client, now: NOW });
      await client.account.updateMany({
        where: { userId: user.id },
        data: { currentBalanceCents: 500_000 },
      });
    }
    const account =
      kind === "demo"
        ? await client.account.findFirstOrThrow({ where: { userId: user.id } })
        : await client.account.create({
            data: {
              userId: user.id,
              source: "csv",
              name: "Checking",
              type: "depository",
              currentBalanceCents: 500_000,
            },
          });
    return { userId: user.id, accountId: account.id };
  }
  const payment = (accountId: string, amountCents = 12_000, toAccountId: string | null = null) => ({
    fromAccountId: accountId,
    toAccountId,
    toName: "Chase Card",
    amountCents,
    purpose: "bill" as const,
    sector: "bills" as const,
  });

  it("the flags are off, and own-account moves come after bills", () => {
    expect(REAL_MONEY_MOVEMENT).toBe(false);
    expect(PAYMENT_ROLLOUT).toEqual({ bills: true, ownAccounts: false, underCap: false });
  });

  it("no code selects a real vendor: only tests and the adapters' own folder name them", () => {
    const walk = (dir: string): string[] =>
      readdirSync(dir).flatMap((name) => {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) return name === "generated" ? [] : walk(path);
        return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
      });
    const uses = walk("src").filter((p) =>
      /spinwheelAdapter|dwollaAdapter|queuedPartner\(/.test(readFileSync(p, "utf8")),
    );
    expect(uses.sort()).toEqual(
      [
        "src/lib/money-movement/adapters/dwolla.ts",
        "src/lib/money-movement/adapters/spinwheel.ts",
        "src/lib/money-movement/queue.ts",
      ].sort(),
    );
  });

  it("a real account has no partner at all, exactly as today", async () => {
    const { userId, accountId } = await person("real");
    expect(await moneyPartnerFor(userId, { client })).toBeNull();
    vi.stubEnv("PAYMENT_REHEARSAL", "1");
    expect(await moneyPartnerFor(userId, { client })).toBeNull();
    await expect(scheduleTransfer(userId, payment(accountId), "person", options())).rejects.toThrow(
      "none is connected",
    );
    // And given a partner by force, the check still refuses.
    await expect(
      scheduleTransfer(userId, payment(accountId), "person", {
        ...options(),
        partner: standInPartner,
      }),
    ).rejects.toMatchObject({ reason: "read_only" });
    expect(await client.moneyTransfer.count({ where: { userId } })).toBe(0);
  });

  describe("Jane prepares, you pay", () => {
    it("is off unless rehearsing; on the demo bank the stand-in stays", async () => {
      const { userId } = await person("demo");
      expect((await moneyPartnerFor(userId, { client }))?.name).toBe(standInPartner.name);
      vi.stubEnv("PAYMENT_REHEARSAL", "1");
      expect((await moneyPartnerFor(userId, { client }))?.name).toBe(PREPARED_PARTNER);
    });

    it("keeps the instruction, reminds, and marks it paid only when a debit shows", async () => {
      vi.stubEnv("PAYMENT_REHEARSAL", "1");
      const { userId, accountId } = await person("demo");
      const { id } = await scheduleTransfer(userId, payment(accountId), "person", options());
      const row = await client.moneyTransfer.findUniqueOrThrow({ where: { id } });
      expect(row).toMatchObject({ partner: PREPARED_PARTNER, status: "pending" });
      expect(row.partnerRef).toMatch(/^PREP-/);

      expect(await remindPrepared(userId, { client, now: NOW })).toBe(1);
      const [alert] = await client.alert.findMany({
        where: { userId, key: { startsWith: "prepared:" } },
      });
      expect(alert.title).toContain("Pay $120.00 to Chase Card by");
      expect(alert.body).toContain("You pay it from your own bank");

      // Its day comes with no payment: nothing is pretended.
      expect(await settleTransfers(userId, { client, now: RUN_DAY })).toBe(0);
      await client.transaction.create({
        data: {
          userId,
          accountId,
          source: "csv",
          date: new Date("2026-10-19T00:00:00Z"),
          description: "CHASE CARD EPAY",
          amountCents: 12_000,
        },
      });
      expect(await settleTransfers(userId, { client, now: RUN_DAY })).toBe(1);
      expect((await client.moneyTransfer.findUniqueOrThrow({ where: { id } })).status).toBe(
        "completed",
      );
    });

    it("an unrelated debit, or the wrong amount, isn't it", async () => {
      const { userId, accountId } = await person("demo");
      const partner = preparedPartner(userId, { client });
      const debit = (description: string, amountCents: number) =>
        client.transaction.create({
          data: {
            userId,
            accountId,
            source: "csv",
            date: new Date("2026-10-19T00:00:00Z"),
            description,
            amountCents,
          },
        });
      await debit("TRADER JOES", 12_000);
      await debit("CHASE CARD EPAY", 9_000);
      const check = { runOn: "2026-10-19", amountCents: 12_000, toName: "Chase Card" };
      expect(await partner.settled(check, "2026-10-20")).toBe(false);
      await debit("CHASE CARD EPAY", 12_050);
      expect(await partner.settled(check, "2026-10-20")).toBe(true);
    });

    it("the rollout's rules: a yes each time, bills before own accounts", async () => {
      vi.stubEnv("PAYMENT_REHEARSAL", "1");
      const { userId, accountId } = await person("demo");
      await expect(
        scheduleTransfer(userId, payment(accountId), "autopilot", options()),
      ).rejects.toMatchObject({ reason: "level" });
      await expect(
        scheduleTransfer(userId, payment(accountId, 12_000, accountId), "person", options()),
      ).rejects.toMatchObject({ reason: "not_yet" });
    });

    it("undoing it just drops the instruction", async () => {
      vi.stubEnv("PAYMENT_REHEARSAL", "1");
      const { userId, accountId } = await person("demo");
      const { id } = await scheduleTransfer(userId, payment(accountId), "person", options());
      await cancelTransfer(userId, id, options());
      expect((await client.moneyTransfer.findUniqueOrThrow({ where: { id } })).status).toBe(
        "cancelled",
      );
      expect(await remindPrepared(userId, { client, now: NOW })).toBe(0);
    });
  });

  describe("a vendor behind the queue, mocked", () => {
    it("nothing reaches the vendor until its day, and an undo before then costs nothing", async () => {
      const { userId, accountId } = await person("demo");
      const vendor = fakeVendor();
      const partner = queuedPartner(vendor);
      const { id } = await scheduleTransfer(userId, payment(accountId), "person", {
        ...options(),
        partner,
      });
      const row = await client.moneyTransfer.findUniqueOrThrow({ where: { id } });
      expect(isQueued(row.partnerRef)).toBe(true);
      expect(vendor.sent).toEqual([]);
      // Not due yet.
      expect((await dispatchDue(userId, vendor, options())).sent).toBe(0);
      await cancelTransfer(userId, id, { ...options(), partner });
      expect((await dispatchDue(userId, vendor, { client, now: RUN_DAY })).sent).toBe(0);
      expect(vendor.sent).toEqual([]);
    });

    it("sends on its day through the check, keeps the ref, and settles from the vendor", async () => {
      const { userId, accountId } = await person("demo");
      const vendor = fakeVendor();
      const partner = queuedPartner(vendor);
      const { id } = await scheduleTransfer(userId, payment(accountId), "person", {
        ...options(),
        partner,
      });
      const queuedRef = (await client.moneyTransfer.findUniqueOrThrow({ where: { id } }))
        .partnerRef!;
      expect(await dispatchDue(userId, vendor, { client, now: RUN_DAY })).toEqual({
        sent: 1,
        held: [],
      });
      expect(vendor.sent).toEqual([queuedRef.slice("queued:".length)]);
      expect((await client.moneyTransfer.findUniqueOrThrow({ where: { id } })).partnerRef).toBe(
        "sent-1",
      );
      // Two runs never send it twice.
      expect((await dispatchDue(userId, vendor, { client, now: RUN_DAY })).sent).toBe(0);
      expect(await settleTransfers(userId, { client, now: RUN_DAY, partner })).toBe(1);
      const acts = await client.janeAct.findMany({
        where: { userId, what: { startsWith: "Paid" } },
      });
      expect(acts).toHaveLength(1);
      expect(acts[0].status).toBe("done");
    });

    it("keeps the cushion: not sent if the money isn't there any more", async () => {
      const { userId, accountId } = await person("demo");
      const vendor = fakeVendor();
      await scheduleTransfer(userId, payment(accountId), "person", {
        ...options(),
        partner: queuedPartner(vendor),
      });
      await client.account.updateMany({
        where: { id: accountId },
        data: { currentBalanceCents: 15_000 },
      });
      const out = await dispatchDue(userId, vendor, { client, now: RUN_DAY });
      expect(out.sent).toBe(0);
      expect(out.held[0].why).toContain("cushion");
      expect(vendor.sent).toEqual([]);
    });

    it("the stop-all switch holds it in the queue", async () => {
      const { userId, accountId } = await person("demo");
      const vendor = fakeVendor();
      await scheduleTransfer(userId, payment(accountId), "person", {
        ...options(),
        partner: queuedPartner(vendor),
      });
      await setActsStopped(userId, true, options());
      const out = await dispatchDue(userId, vendor, { client, now: RUN_DAY });
      expect(out.sent).toBe(0);
      expect(out.held).toHaveLength(1);
      expect(vendor.sent).toEqual([]);
    });

    it("a payment that comes back afterwards is marked returned", async () => {
      const { userId, accountId } = await person("demo");
      const settledVendor = fakeVendor("settled");
      const { id } = await scheduleTransfer(userId, payment(accountId), "person", {
        ...options(),
        partner: queuedPartner(settledVendor),
      });
      await dispatchDue(userId, settledVendor, { client, now: RUN_DAY });
      await settleTransfers(userId, {
        client,
        now: RUN_DAY,
        partner: queuedPartner(settledVendor),
      });
      await settleTransfers(userId, {
        client,
        now: new Date(RUN_DAY.getTime() + 10 * 86_400_000),
        partner: queuedPartner(fakeVendor("reversed")),
      });
      expect((await client.moneyTransfer.findUniqueOrThrow({ where: { id } })).status).toBe(
        "returned",
      );
    });

    it("routes bills and own-account moves to their vendors, by the ref afterwards", async () => {
      const bills = { ...fakeVendor(), name: "bills", cancel: vi.fn(async () => true) };
      const own = { ...fakeVendor(), name: "own", cancel: vi.fn(async () => true) };
      const router = routedAdapter(bills, own);
      const base = {
        fromAccountId: "a",
        toName: "x",
        amountCents: 1,
        runOn: "2026-10-19",
        memo: "",
      };
      const options = { key: "k", link: () => null };
      expect(
        (await router.send({ ...base, toAccountId: null }, options)).partnerRef.startsWith(
          "bills:",
        ),
      ).toBe(true);
      const { partnerRef } = await router.send({ ...base, toAccountId: "b" }, options);
      expect(partnerRef.startsWith("own:")).toBe(true);
      await router.cancel(partnerRef);
      expect(own.cancel).toHaveBeenCalled();
      expect(bills.cancel).not.toHaveBeenCalled();
    });
  });
});
