import { randomBytes } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import type { PlaidApi } from "plaid";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));

import { gather } from "@/lib/jane-agent/brain";
import { runChatTool } from "@/lib/jane-agent/claude-tools";
import { loadSnapshot } from "@/lib/jane-agent/snapshot";
import { sendToJane } from "@/lib/jane-agent/typing";
import { linkDemoBank } from "@/lib/plaid/demo";
import { syncItem } from "@/lib/plaid/sync";
import { pmiLines } from "@/lib/jane-agent/mortgage-replies";
import { loadHomeEquity, saveHomeFacts } from "./home-equity";
import { checkRates } from "./refinance";
import { loadMortgage } from "./mortgage";

// Spec step 115 against a real, migrated Postgres, on the demo bank: the mortgage's PMI and
// escrow from Plaid Liabilities, PMI by the one rule (the home's value when the loan began, as
// /loans/equity has it), the escrow change in the payment, extra principal, and a refinance
// that doesn't pay at today's rates.

const url = process.env.TEST_DATABASE_URL;
// A PMI notice's key ("homeeq:pmi:…", "homeeq:pmi_ended:…"), not any key with "pmi" in it: an
// account id is random and once held "…5gpmik…" (the escrow notice failed this file on CI).
const isPmiKey = (key: string) => /:pmi[_:]/.test(key);
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
    // PMI waits for the home's value when the loan began (one rule, as /loans/equity).
    expect(m.pmi).toBeNull();
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

  // Loans QA: /loans/mortgage measured PMI against today's value (the home the person owns)
  // and /loans/equity against the value when the loan began. One rule now: the original value.
  it("measures PMI one way, against the home's value when the loan began, everywhere", async () => {
    // Today's value doesn't decide it: a $450,000 home still asks for the original value.
    await client.ownedAsset.updateMany({
      where: { userId, kind: "home" },
      data: { valueCents: 45_000_000 },
    });
    expect((await loadMortgage(userId, opts()))!.pmi).toBeNull();
    expect((await fromSource()).filter((x) => isPmiKey(x.dedupeKey))).toEqual([]);
    const ask = await sendToJane(userId, "can I get rid of PMI?", opts());
    expect(ask.reply.body).toContain(
      "Your loan has PMI. Tell me the home's value when the loan began and I'll tell you when it can come off.",
    );
    const asked = JSON.parse((await runChatTool(userId, "mortgage", {}, opts())).content);
    expect(asked.pmi).toMatchObject({ status: "needs_the_original_value" });

    // $312,400 of $395,000 is 79.1%: the same figure on both pages, in the chat and the tools.
    await saveHomeFacts(
      userId,
      { originalValueCents: 39_500_000, yearlyTaxCents: null, yearlyInsuranceCents: null },
      opts(),
    );
    const m = (await loadMortgage(userId, opts()))!;
    const e = await loadHomeEquity(userId, opts());
    expect(m.pmi).toEqual(e.pmi);
    expect(m.pmi).toMatchObject({ canAskNow: true, endsNow: false });
    expect(pmiLines(m)[0]).toBe(
      "Your loan is $312,400.00, 79.1% of the home's original value of $395,000.00.",
    );
    const { reply } = await sendToJane(userId, "can I get rid of PMI?", opts());
    expect(reply.body).toContain("79.1% of the home's original value of $395,000.00");
    expect(reply.body).toContain("consumerfinance.gov");
    expect(reply.body).toContain("Refinancing doesn't pay right now");
    const tool = JSON.parse((await runChatTool(userId, "mortgage", {}, opts())).content);
    expect(tool.pmi).toMatchObject({ status: "can_ask", loanAsShareOfOriginalValue: 79.1 });
    expect(tool.escrowChange).toMatchObject({ to: "$2,198.31" });
    const equityTool = JSON.parse((await runChatTool(userId, "home_equity", {}, opts())).content);
    expect(equityTool.pmi).toMatchObject({
      loanAsShareOfOriginalValue: 79.1,
      canAskToCancelNow: true,
    });
    // Raised once, by the home loan's source with the request drafted there, not by both.
    const snapshot = await loadSnapshot(userId, opts());
    // The mortgage and the home loan sources both see this loan; only the home loan's raises it.
    const raised = gather(snapshot!, LINKED, { trigger: "sync" }).filter(
      (x) => (x.source === "mortgage" || x.source === "home_equity") && isPmiKey(x.dedupeKey),
    );
    expect(raised.map((x) => x.source)).toEqual(["home_equity"]);
  });
});
