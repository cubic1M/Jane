import { randomBytes } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import type { PlaidApi } from "plaid";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));

import { gather, plan } from "@/lib/jane-agent/brain";
import { runChatTool } from "@/lib/jane-agent/claude-tools";
import { loadSnapshot } from "@/lib/jane-agent/snapshot";
import { sendToJane } from "@/lib/jane-agent/typing";
import { linkDemoBank } from "@/lib/plaid/demo";
import { syncItem } from "@/lib/plaid/sync";
import { checkRates } from "./refinance";
import { loadMortgage } from "./mortgage";

// Spec step 115 against a real, migrated Postgres, on the demo bank: the mortgage's PMI and
// escrow from Plaid Liabilities, PMI removal raised once the home's value the person gives
// puts the loan under 80% (with the steps and a drafted request), the escrow change in the
// payment, extra principal, and a refinance that doesn't pay at today's rates.

const url = process.env.TEST_DATABASE_URL;
const LINKED = new Date("2026-10-18T15:00:00Z");

describe.runIf(url)("the mortgage, watched, against a real database", () => {
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
  const opts = (now = LINKED) => ({ client, now });
  const fromSource = async () => {
    const snapshot = await loadSnapshot(userId, opts());
    return gather(snapshot!, LINKED, { trigger: "sync" }).filter((m) => m.source === "mortgage");
  };

  beforeAll(async () => {
    vi.stubEnv("TOKEN_ENCRYPTION_KEY", randomBytes(32).toString("base64"));
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    vi.stubEnv("PLAID_CLIENT_ID", "");
    vi.stubEnv("PLAID_SECRET", "");
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
    const user = await client.user.create({
      data: { email: `mortgage-${crypto.randomUUID()}@example.com`, name: "Sam Demo" },
    });
    userId = user.id;
    created.push(userId);
    const { itemId } = await linkDemoBank(userId, { client, now: LINKED });
    await syncItem(itemId, { client, api: plaid, now: LINKED });
    await checkRates(userId, opts());
  }, 120_000);
  afterAll(async () => {
    await client.user.deleteMany({ where: { id: { in: created } } });
    await client.$disconnect();
    vi.unstubAllEnvs();
  });

  it("keeps the mortgage's PMI and escrow from the bank, and spots the escrow change", async () => {
    const m = (await loadMortgage(userId, opts()))!;
    expect(m).toMatchObject({
      hasPmi: true,
      escrowBalanceCents: 421_055,
      hasPrepaymentPenalty: false,
    });
    // The demo bank gives its sample person a $380,000 home: 82.2% of it is still owed.
    expect(m.pmi).toMatchObject({ kind: "not_yet" });
    expect(m.escrow).toMatchObject({ fromCents: 214_154, toCents: 219_831, changeCents: 5_677 });
    // A 3.99% mortgage: nothing in the catalog is cheaper, so refinancing never pays back.
    expect(m.refi?.breakEvenMonths).toBeNull();
    expect(m.extra!.scenarios.map((s) => s.extraCents)).toEqual([10_000, 25_000, 50_000]);
    const messages = await fromSource();
    expect(messages.map((x) => x.dedupeKey)).toEqual([
      `mortgage:escrow:${m.loan.accountId}:219831`,
    ]);
    expect(messages[0].body).toMatch(
      /^Your mortgage payment went up \$56\.77, from \$2,141\.54 to \$2,198\.31\./,
    );
  });

  it("raises PMI removal once the home's value puts the loan under 80%, with a drafted request", async () => {
    const m = (await loadMortgage(userId, opts()))!;
    // The demo home is $380,000.
    // $312,400 of $380,000 is 82.2%: not yet.
    expect((await loadMortgage(userId, opts()))!.pmi).toMatchObject({ kind: "not_yet" });
    expect((await fromSource()).filter((x) => x.dedupeKey.includes("pmi"))).toEqual([]);

    await client.ownedAsset.updateMany({
      where: { userId, kind: "home" },
      data: { valueCents: 45_000_000 },
    });
    const now = (await loadMortgage(userId, opts()))!;
    expect(now.pmi).toMatchObject({ kind: "can_ask" });
    expect(now.letter).toContain("69.4% of my home's current value of about $450,000.00");
    const [pmi] = (await fromSource()).filter((x) => x.dedupeKey.includes("pmi"));
    expect(pmi).toMatchObject({
      kind: "decision",
      dedupeKey: `mortgage:pmi:${now.loan.accountId}`,
    });
    expect(pmi.body).toContain(
      "PMI can come off: your loan is 69.4% of the value you gave for your home",
    );
    expect(pmi.body).toContain("I've drafted the request for you to send your servicer.");
    // Once: after it's been said, never again.
    const snapshot = await loadSnapshot(userId, opts());
    const again = plan(snapshot!, { recent: [], seenKeys: [pmi.dedupeKey] }, LINKED, {
      trigger: "open",
    });
    expect(again.filter((x) => x.dedupeKey === pmi.dedupeKey)).toEqual([]);
  });

  it("answers about PMI and the mortgage, by rules and for Claude", async () => {
    const { reply } = await sendToJane(userId, "can I get rid of PMI?", opts());
    expect(reply.body).toContain("PMI can come off");
    expect(reply.body).toContain("consumerfinance.gov");
    expect(reply.body).toContain("Refinancing doesn't pay right now");
    const tool = await runChatTool(userId, "mortgage", {}, opts());
    const output = JSON.parse(tool.content);
    expect(output.pmi).toMatchObject({ status: "can_ask", loanToValue: 69.4 });
    expect(output.escrowChange).toMatchObject({ to: "$2,198.31" });
    expect(tool.cents).toContain(31_240_000);
  });
});
