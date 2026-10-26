import { randomBytes } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import type { PlaidApi } from "plaid";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));

import { logAudit } from "@/lib/audit";
import { takeChatAction } from "@/lib/jane-agent/actions";
import { runChatTool } from "@/lib/jane-agent/claude-tools";
import { rentingSource } from "@/lib/jane-agent/sources/renting";
import { loadSnapshot } from "@/lib/jane-agent/snapshot";
import { sendToJane } from "@/lib/jane-agent/typing";
import { linkDemoBank } from "@/lib/plaid/demo";
import { syncItem } from "@/lib/plaid/sync";
import { loadProfileInput } from "@/lib/profile";
import {
  RentingError,
  loadRenting,
  markDepositReturned,
  saveDeposit,
  setRentReporting,
} from "./renting";

// Spec step 248 against a real, migrated Postgres, on Maya's demo bank: her rent is found, it
// is reported only after her opt-in, and a security deposit is followed to its due date.

const url = process.env.TEST_DATABASE_URL;
const NOW = new Date("2026-10-18T15:00:00Z");
const MINUTE = 60 * 1000;
const context = { now: NOW, local: { date: "2026-10-18", hour: 8 }, trigger: "open" as const };

describe.runIf(url)("renting against a real database", { timeout: 120_000 }, () => {
  let client: PrismaClient;
  let userId: string;
  const created: string[] = [];
  const plaid = new Proxy(
    {},
    {
      get: () => () => {
        throw new Error("The demo bank must never call Plaid");
      },
    },
  ) as PlaidApi;
  let tick = 0;
  const later = () => new Date(NOW.getTime() + ++tick * MINUTE);
  const opts = (now = NOW) => ({ client, now });

  beforeAll(async () => {
    vi.stubEnv("TOKEN_ENCRYPTION_KEY", randomBytes(32).toString("base64"));
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    vi.stubEnv("PLAID_CLIENT_ID", "");
    vi.stubEnv("PLAID_SECRET", "");
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
    const user = await client.user.create({
      data: { email: `renting-${crypto.randomUUID()}@example.com` },
    });
    userId = user.id;
    created.push(userId);
    const { itemId } = await linkDemoBank(userId, { client, now: NOW, person: "renter" });
    await syncItem(itemId, { client, api: plaid, now: NOW });
  }, 120_000);
  afterAll(async () => {
    await client.user.deleteMany({ where: { id: { in: created } } });
    await client.$disconnect();
    vi.unstubAllEnvs();
  });

  it("finds Maya's rent, and nothing is reported before she opts in", async () => {
    const d = await loadRenting(userId, opts());
    expect(d.renter).toBe(true);
    expect(d.monthlyCents).toBe(145_000);
    expect(d.payments.length).toBeGreaterThanOrEqual(3);
    expect(d.reporting.on).toBe(false);
    expect(await client.rentReporting.count({ where: { userId } })).toBe(0);
    expect((await loadProfileInput(userId, opts())).rentReportingOn).toBe(false);
  });

  it("offers reporting in the chat, answers the question, and a yes is the opt-in", async () => {
    const snapshot = (await loadSnapshot(userId, opts()))!;
    const offer = rentingSource
      .gather(snapshot, context)
      .find((m) => m.dedupeKey === "rent-report:2026")!;
    expect(offer.actions.map((a) => a.id)).toContain("rent.report_on");
    expect(offer.body).toContain("only starts if you say yes");

    const { reply } = await sendToJane(userId, "can you report my rent to the credit bureaus", {
      client,
      now: later(),
    });
    expect(reply.body).toContain("It isn't on your credit file.");
    expect(reply.body).toContain("only starts if you say yes");
    const tool = JSON.parse((await runChatTool(userId, "renting", {}, opts())).content);
    expect(tool.rentReporting.on).toBe(false);
    expect(await client.rentReporting.count({ where: { userId } })).toBe(0);

    const tapped = await takeChatAction(userId, reply.id, "rent.report_on", {
      client,
      now: later(),
    });
    expect(tapped.message.status).toBe("answered");
    expect(await client.rentReporting.count({ where: { userId } })).toBe(1);
    expect(logAudit).toHaveBeenCalledWith(
      { type: "user", id: userId },
      "rent_reporting_changed",
      null,
      { on: true },
    );
    expect((await loadProfileInput(userId, opts())).rentReportingOn).toBe(true);
    const after = (await loadSnapshot(userId, opts()))!;
    expect(rentingSource.gather(after, context).map((m) => m.dedupeKey)).not.toContain(
      "rent-report:2026",
    );
  });

  it("can be turned off, and nothing else of anyone's changes", async () => {
    await setRentReporting(userId, false, opts());
    expect((await loadRenting(userId, opts())).reporting.on).toBe(false);
  });

  it("follows a deposit to the day the state says it is due back", async () => {
    await expect(
      saveDeposit(userId, { amountCents: 0, state: "CA", movedOutOn: null }, opts()),
    ).rejects.toBeInstanceOf(RentingError);
    await expect(
      saveDeposit(userId, { amountCents: 100, state: "California", movedOutOn: null }, opts()),
    ).rejects.toThrow(/state/);
    const id = await saveDeposit(
      userId,
      { amountCents: 150_000, state: "ca", movedOutOn: "2026-10-01" },
      opts(),
    );
    const d = await loadRenting(userId, opts());
    const dep = d.deposits.find((x) => x.id === id)!;
    expect(dep.view).toMatchObject({ dueOn: "2026-10-22", daysLeft: 4, status: "due" });
    expect(dep.needsAttention).toBe(true);

    const snapshot = (await loadSnapshot(userId, opts()))!;
    const m = rentingSource
      .gather(snapshot, context)
      .find((x) => x.dedupeKey.startsWith("deposit:"))!;
    expect(m.body).toContain("is due back by");
    expect(m.body).toContain("Return it or itemise deductions within 21 days.");

    const { reply } = await sendToJane(userId, "when do I get my security deposit back", {
      client,
      now: later(),
    });
    expect(reply.body).toContain("$1,500.00 deposit (CA): due back by");
    expect(reply.body).toContain("California Civil Code § 1950.5");

    const late = await loadRenting(userId, opts(new Date("2026-10-25T12:00:00Z")));
    expect(late.deposits[0].view.status).toBe("overdue");

    await markDepositReturned(userId, id, 140_000, opts());
    const back = (await loadRenting(userId, opts())).deposits[0];
    expect(back.view.status).toBe("returned");
    expect(back.returnedCents).toBe(140_000);
    expect(back.needsAttention).toBe(false);
    await expect(markDepositReturned(userId, "nope", 1, opts())).rejects.toBeInstanceOf(
      RentingError,
    );
  });

  it("keeps one person's deposit from another", async () => {
    const other = await client.user.create({
      data: { email: `renting-other-${crypto.randomUUID()}@example.com` },
    });
    created.push(other.id);
    expect((await loadRenting(other.id, opts())).deposits).toEqual([]);
    const mine = await client.securityDeposit.findFirstOrThrow({ where: { userId } });
    await expect(markDepositReturned(other.id, mine.id, 1, opts())).rejects.toBeInstanceOf(
      RentingError,
    );
  });
});
