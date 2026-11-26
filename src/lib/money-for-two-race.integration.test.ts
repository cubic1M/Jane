import { PrismaPg } from "@prisma/adapter-pg";
import type { PlaidApi } from "plaid";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

const hooks = vi.hoisted(() => ({
  during: null as null | (() => Promise<void>),
  schedule: vi.fn(),
  cancel: vi.fn(async () => true),
}));
vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));
vi.mock("@/lib/money-movement/partner", async (original) => {
  const real = await original<typeof import("@/lib/money-movement/partner")>();
  return {
    ...real,
    moneyPartnerFor: async (...args: Parameters<typeof real.moneyPartnerFor>) => {
      const partner = await real.moneyPartnerFor(...args);
      if (!partner) return partner;
      return {
        ...partner,
        schedule: async (request: Parameters<typeof partner.schedule>[0]) => {
          hooks.schedule(request);
          if (hooks.during) await hooks.during();
          return partner.schedule(request);
        },
        cancel: async (ref: string) => {
          hooks.cancel();
          return partner.cancel(ref);
        },
      };
    },
  };
});

import { acceptInvite, invitePartner, setAccountSharing } from "@/lib/household";
import { linkDemoBank } from "@/lib/plaid/demo";
import { syncItem } from "@/lib/plaid/sync";
import { scheduleTransfer } from "@/lib/money-movement/transfers";
import { stubTestKeys } from "@/lib/__fixtures__/env";
import { MoneyForTwoError, approveBigMove, declineBigMove, setBigMoveLimit } from "./money-for-two";

// A big move waits for the partner's tap (CodeRabbit sweep part 2, chunk act-02): an approval
// claims the move before it goes to the money-movement partner, so a decline that arrives while
// it is being scheduled cannot also succeed.

const url = process.env.TEST_DATABASE_URL;
const NOW = new Date("2026-10-16T15:00:00Z");

describe.runIf(url)("a big move, approved and declined at once", { timeout: 120_000 }, () => {
  let client: PrismaClient;
  const created: string[] = [];
  const api = new Proxy(
    {},
    {
      get: () => () => {
        throw new Error("no Plaid");
      },
    },
  ) as PlaidApi;

  async function person(prefix: string) {
    const user = await client.user.create({
      data: { email: `${prefix}-${crypto.randomUUID()}@example.com`, name: prefix },
    });
    created.push(user.id);
    const { itemId } = await linkDemoBank(user.id, { client, now: NOW });
    await syncItem(itemId, { client, api, now: NOW });
    return { id: user.id, email: user.email };
  }

  async function waitingMove() {
    const a = await person("dan");
    const b = await person("lena");
    const { token } = await invitePartner(a, b.email, { client, now: NOW });
    await acceptInvite(b, token, { client, now: NOW });
    const shared = await client.account.findFirstOrThrow({
      where: { userId: a.id, subtype: "checking" },
    });
    await setAccountSharing(a.id, shared.id, true, { client });
    await setBigMoveLimit(a.id, 50_000, { client });
    const big = await scheduleTransfer(
      a.id,
      {
        fromAccountId: shared.id,
        toAccountId: null,
        toName: "Car dealer",
        amountCents: 80_000,
        purpose: "bill",
        sector: "bills",
      },
      "person",
      { client, now: NOW },
    );
    expect(big.awaitingPartner).toBe(true);
    return { a, b, id: big.id };
  }

  beforeAll(() => {
    stubTestKeys();
    vi.stubEnv("AUTH_SECRET", "test-secret-for-unsubscribe-links");
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  });
  afterAll(async () => {
    await client.user.deleteMany({ where: { id: { in: created } } });
    await client.$disconnect();
    vi.unstubAllEnvs();
  });

  it("refuses a decline that arrives while the approval is being scheduled", async () => {
    hooks.schedule.mockClear();
    hooks.cancel.mockClear();
    const { b, id } = await waitingMove();
    let declined: unknown = "not tried";
    hooks.during = async () => {
      declined = await declineBigMove(b.id, id, { client, now: NOW }).then(
        () => "declined",
        (e: unknown) => e,
      );
    };
    try {
      await approveBigMove(b.id, id, { client, now: NOW }).catch(() => {});
    } finally {
      hooks.during = null;
    }
    const row = await client.moneyTransfer.findUniqueOrThrow({ where: { id } });
    // Either it is scheduled and the decline was refused, or it was declined and nothing was
    // scheduled for good: never both "declined" and still going.
    if (declined === "declined") {
      expect(row.status).toBe("cancelled");
      // ...and if it did reach the partner, that was cancelled again.
      if (hooks.schedule.mock.calls.length > 0) expect(hooks.cancel).toHaveBeenCalled();
    } else {
      expect(declined).toBeInstanceOf(MoneyForTwoError);
      expect(row.status).toBe("pending");
      expect(row.partnerRef).toBeTruthy();
    }
  });

  it("puts the move back to waiting when scheduling fails", async () => {
    const { b, id } = await waitingMove();
    hooks.during = async () => {
      throw new Error("partner down");
    };
    try {
      await expect(approveBigMove(b.id, id, { client, now: NOW })).rejects.toThrow("partner down");
    } finally {
      hooks.during = null;
    }
    expect(await client.moneyTransfer.findUniqueOrThrow({ where: { id } })).toMatchObject({
      status: "awaiting_partner",
      partnerRef: null,
    });
  });
});
