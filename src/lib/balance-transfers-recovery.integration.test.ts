import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));

// Where a test says a step fails: the promotion's insert inside the start's transaction, or the
// promotion's removal when a transfer ends.
const fail: { promoInsert: boolean; promoRemoval: boolean } = {
  promoInsert: false,
  promoRemoval: false,
};
vi.mock("@/lib/db-scoped", async (original) => {
  const real = await original<typeof import("@/lib/db-scoped")>();
  return {
    ...real,
    personTransaction: ((userId: string, run: (tx: never) => Promise<unknown>, client?: never) =>
      real.personTransaction(
        userId,
        (tx) =>
          run(
            (fail.promoInsert
              ? new Proxy(tx, {
                  get: (target, key) =>
                    key === "cardPromo"
                      ? {
                          create: async () => {
                            throw new Error("promotion insert failed");
                          },
                        }
                      : Reflect.get(target, key),
                })
              : tx) as never,
          ),
        client,
      )) as unknown as typeof real.personTransaction,
    scopedFor: (...args: Parameters<typeof real.scopedFor>) => {
      const scoped = real.scopedFor(...args);
      return {
        ...scoped,
        cardPromos: {
          ...scoped.cardPromos,
          deleteMany: async (...a: Parameters<typeof scoped.cardPromos.deleteMany>) => {
            if (fail.promoRemoval) throw new Error("promotion removal failed");
            return scoped.cardPromos.deleteMany(...a);
          },
        },
      };
    },
  };
});

import { track } from "@/lib/analytics";
import { linkDemoBank } from "@/lib/plaid/demo";
import { syncItem } from "@/lib/plaid/sync";
import { NO_PLAID as plaid } from "@/lib/__fixtures__/plaid";
import { stubTestKeys } from "@/lib/__fixtures__/env";
import { endTransfer, loadTransfers, startTransfer } from "./balance-transfers";

// CodeRabbit sweep 1c (lib-01): a transfer and its promotion exist together or not at all, ending
// one can be retried until its cleanup is done, and analytics failing hides neither.

const url = process.env.TEST_DATABASE_URL;
const LINKED = new Date("2026-10-18T15:00:00Z");

describe.runIf(url)("balance transfers: failed steps", { timeout: 120_000 }, () => {
  let client: PrismaClient;
  let userId = "";
  const opts = () => ({ client, now: LINKED });

  beforeAll(async () => {
    stubTestKeys();
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
    userId = (
      await client.user.create({
        data: { email: `bt-recovery-${crypto.randomUUID()}@example.com` },
      })
    ).id;
    const { itemId } = await linkDemoBank(userId, { client, now: LINKED });
    await syncItem(itemId, { client, api: plaid, now: LINKED });
  }, 120_000);
  afterAll(async () => {
    await client.user.deleteMany({ where: { id: userId } });
    await client.$disconnect();
    vi.unstubAllEnvs();
  });

  const pick = async () => {
    const [card] = (await loadTransfers(userId, opts())).comparisons;
    return { debtKey: card.debtKey, offerId: card.pick!.offer.id };
  };

  it("leaves no transfer, deadline or promotion when the promotion can't be saved, and starts on retry", async () => {
    const input = await pick();
    fail.promoInsert = true;
    await expect(startTransfer(userId, input, opts())).rejects.toThrow("promotion insert failed");
    fail.promoInsert = false;
    expect(await client.balanceTransfer.count({ where: { userId } })).toBe(0);
    expect(await client.deadline.count({ where: { userId } })).toBe(0);
    const started = await startTransfer(userId, input, opts());
    expect(started.status).toBe("active");
    expect(await client.cardPromo.count({ where: { userId } })).toBe(1);
  });

  it("can be ended again when its cleanup failed, and ends even if analytics fails", async () => {
    const [t] = (await loadTransfers(userId, opts())).transfers;
    fail.promoRemoval = true;
    await expect(endTransfer(userId, t.id, "done", opts())).rejects.toThrow(
      "promotion removal failed",
    );
    fail.promoRemoval = false;
    expect((await loadTransfers(userId, opts())).transfers[0].status).toBe("active");
    vi.mocked(track).mockRejectedValue(new Error("analytics down"));
    const ended = await endTransfer(userId, t.id, "done", opts());
    vi.mocked(track).mockReset();
    expect(ended.status).toBe("done");
    expect(await client.cardPromo.count({ where: { userId } })).toBe(0);
    expect(await client.deadline.count({ where: { userId, doneAt: null } })).toBe(0);
  });
});
