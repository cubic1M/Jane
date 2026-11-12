import { randomBytes } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import type { PlaidApi } from "plaid";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));

import { scopedFor } from "@/lib/db-scoped";
import { createCsvAccountRow } from "@/lib/import/upload";
import { sendToJane } from "@/lib/jane-agent/typing";
import { linkDemoBank } from "@/lib/plaid/demo";
import { syncItem } from "@/lib/plaid/sync";

// Paying a buy now, pay later plan off early, and waiting for payday before a new one, are
// suggestions on a loan: demo advice only (CLAUDE.md, step 98). The chat's real-account round
// (11-12) found both, with the "Demo advice: sample data" label, in a real account's answers.
// A real account gets its plans, installments and forecast.
const url = process.env.TEST_DATABASE_URL;
const LINKED = new Date("2026-10-18T15:00:00Z");
const MINUTE = 60 * 1000;

describe.runIf(url)("buy now, pay later answers on a real account", { timeout: 120_000 }, () => {
  let client: PrismaClient;
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
  const later = () => new Date(LINKED.getTime() + ++tick * MINUTE);
  async function person(real: boolean) {
    const user = await client.user.create({
      data: { email: `bnpl-real-${crypto.randomUUID()}@example.com` },
    });
    created.push(user.id);
    const { itemId } = await linkDemoBank(user.id, { client, now: LINKED });
    await syncItem(itemId, { client, api: plaid, now: LINKED });
    if (real) {
      await createCsvAccountRow(scopedFor(user.id, client), {
        name: "Own checking",
        kind: "checking",
        balance: null,
      });
    }
    return user.id;
  }

  beforeAll(async () => {
    vi.stubEnv("TOKEN_ENCRYPTION_KEY", randomBytes(32).toString("base64"));
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    vi.stubEnv("PLAID_CLIENT_ID", "");
    vi.stubEnv("PLAID_SECRET", "");
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  }, 120_000);
  afterAll(async () => {
    await client.user.deleteMany({ where: { id: { in: created } } });
    await client.$disconnect();
    vi.unstubAllEnvs();
  });

  it("lists the plans without the payoff suggestion or the demo label", async () => {
    const [real, demo] = [await person(true), await person(false)];
    const ask = "what buy now pay later payments do I have coming?";
    const { reply: forReal } = await sendToJane(real, ask, { client, now: later() });
    const { reply: forDemo } = await sendToJane(demo, ask, { client, now: later() });
    expect(forReal.body).toMatch(/buy now, pay later plans?, with \$/);
    expect(forReal.body).not.toMatch(/costs nothing extra/);
    expect(forReal.refs.advice).toBeUndefined();
    expect(forReal.actions.map((a) => a.id)).not.toContain("bnpl.payoff");
    // The demo bank still gets it, labelled.
    expect(forDemo.body).toMatch(/costs nothing extra/);
    expect(forDemo.refs.advice).toBe(true);
  });

  it("says whether a new plan fits the forecast, without what to do about it", async () => {
    const real = await person(true);
    const { reply } = await sendToJane(real, "can I afford a $20,000 Klarna plan?", {
      client,
      now: later(),
    });
    expect(reply.body).toMatch(/under the \$100\.00 I like to keep/);
    expect(reply.body).not.toMatch(/Waiting for payday/);
    expect(reply.refs.advice).toBeUndefined();
  });
});
