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
import { homeEquitySource } from "@/lib/jane-agent/sources/home-equity";
import { loadSnapshot } from "@/lib/jane-agent/snapshot";
import { sendToJane } from "@/lib/jane-agent/typing";
import { parseActions, parseRefs } from "@/lib/jane-agent/types";
import { linkDemoBank } from "@/lib/plaid/demo";
import { syncItem } from "@/lib/plaid/sync";
import {
  HomeEquityError,
  compareHomeProject,
  loadHomeEquity,
  markHomeRequestSent,
  saveHomeFacts,
} from "./home-equity";

// Spec step 228 against a real, migrated Postgres, on the demo bank (a $312,400 mortgage at
// 3.99% that began at $400,000, PMI, $4,210.55 in escrow and a $2,198.31 payment): PMI measured
// against the original value, escrow against the bills, and a project compared three ways.

const url = process.env.TEST_DATABASE_URL;
const LINKED = new Date("2026-10-18T15:00:00Z");
const DAY = 86_400_000;
const MINUTE = 60 * 1000;
const context = { now: LINKED, local: { date: "2026-10-18", hour: 8 }, trigger: "open" as const };

describe.runIf(url)("a home's equity against a real database", { timeout: 120_000 }, () => {
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
  const opts = (now = LINKED) => ({ client, now });
  async function demoPerson(prefix: string) {
    const user = await client.user.create({
      data: { email: `${prefix}-${crypto.randomUUID()}@example.com`, name: "Sam Demo" },
    });
    created.push(user.id);
    const { itemId } = await linkDemoBank(user.id, { client, now: LINKED });
    await syncItem(itemId, { client, api: plaid, now: LINKED });
    return user.id;
  }
  const fromSource = async (id: string, now = LINKED) =>
    homeEquitySource.gather((await loadSnapshot(id, opts(now)))!, { ...context, now });

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

  it("asks for the original value before saying anything about PMI", async () => {
    const id = await demoPerson("eq-none");
    const e = await loadHomeEquity(id, opts());
    expect(e).toMatchObject({ available: true, hasPmi: true, pmi: null, escrow: null });
    expect(await fromSource(id)).toEqual([]);
    const { reply } = await sendToJane(id, "when does my PMI end by itself?", {
      client,
      now: later(),
    });
    expect(reply.body).toMatch(/^PMI is measured against the home's value when the loan began/);
    expect(reply.body).toContain("I don't guess it");
  });

  it("dates the 80% ask and the 78% end, then drafts the request once it can be asked", async () => {
    const id = await demoPerson("eq-pmi");
    await saveHomeFacts(
      id,
      {
        originalValueCents: 50_000_000,
        yearlyTaxCents: null,
        yearlyInsuranceCents: null,
      },
      opts(),
    );
    const before = await loadHomeEquity(id, opts());
    // $312,400 of $500,000 is 62.5%: already under both lines.
    expect(before.pmi).toMatchObject({ canAskNow: true, endsNow: true });
    const [ended] = await fromSource(id);
    expect(ended).toMatchObject({
      kind: "heads_up",
      dedupeKey: expect.stringContaining("pmi_ended"),
    });

    // $395,000: 79.1%, askable but not yet ending by itself.
    await saveHomeFacts(
      id,
      {
        originalValueCents: 39_500_000,
        yearlyTaxCents: null,
        yearlyInsuranceCents: null,
      },
      opts(),
    );
    const e = await loadHomeEquity(id, opts());
    expect(e.pmi).toMatchObject({ canAskNow: true, endsNow: false });
    expect(e.pmi!.autoOn! > "2026-10-18").toBe(true);
    expect(e.pmiLetter).toContain("79.1% of the home's original value of $395,000.00");
    const [ask] = await fromSource(id);
    expect(ask).toMatchObject({
      kind: "decision",
      dedupeKey: `homeeq:pmi:${e.accountId}`,
      refs: { homeRequest: "pmi" },
    });
    expect(ask.body).toContain("I won't send it myself.");

    // The chat answer carries the letter and the button; the tap only records it.
    const { reply } = await sendToJane(id, "when does my PMI end by itself?", {
      client,
      now: later(),
    });
    expect(reply.body).toContain("To my mortgage servicer:");
    expect(parseActions(reply.actions)[0].id).toBe("homeeq.sent");
    expect(parseRefs(reply.refs).homeRequest).toBe("pmi");
    const tapped = await takeChatAction(id, reply.id, "homeeq.sent", { client, now: later() });
    expect(tapped.message.refs.note).toMatch(/^Noted\. I'll check back in 30 days/);
    expect(vi.mocked(logAudit)).toHaveBeenCalledWith(
      { type: "user", id },
      "home_request_sent",
      expect.objectContaining({ type: "home_equity" }),
      { which: "pmi" },
    );
    expect((await loadHomeEquity(id, opts())).facts.pmiLetterSentOn).toBe("2026-10-18");
    expect(await fromSource(id)).toEqual([]);
    // Thirty days on and PMI still shows: one follow-up.
    const later30 = new Date(LINKED.getTime() + 31 * DAY);
    const followUp = await fromSource(id, later30);
    expect(followUp.map((m) => m.dedupeKey)).toEqual([
      `homeeq:pmi_followup:${e.accountId}:2026-10-18`,
    ]);
  });

  it("checks escrow against the bills and drafts a refund request when it's overfunded", async () => {
    const id = await demoPerson("eq-escrow");
    // $2,198.31 less $1,907.30 of principal and interest leaves about $291 a month in escrow,
    // $3,492 a year. Bills of $2,600 a year leave it over.
    await saveHomeFacts(
      id,
      {
        originalValueCents: null,
        yearlyTaxCents: 180_000,
        yearlyInsuranceCents: 80_000,
      },
      opts(),
    );
    const e = await loadHomeEquity(id, opts());
    expect(e.escrow).toMatchObject({ kind: "over", billsCents: 260_000 });
    expect(e.escrowLetter).toContain("$2,600.00 a year ($1,800.00 tax and $800.00 insurance)");
    const [msg] = await fromSource(id);
    expect(msg).toMatchObject({ kind: "decision", refs: { homeRequest: "escrow" } });
    const { reply } = await sendToJane(id, "is my escrow too high?", { client, now: later() });
    expect(reply.body).toMatch(/^Your tax and insurance bills come to \$2,600\.00 a year/);
    await takeChatAction(id, reply.id, "homeeq.sent", { client, now: later() });
    expect((await loadHomeEquity(id, opts())).facts.escrowRequestSentOn).toBe("2026-10-18");
    expect(await fromSource(id)).toEqual([]);

    // Bills bigger than what's collected: a warning in the answer, no request to send.
    await saveHomeFacts(
      id,
      {
        originalValueCents: null,
        yearlyTaxCents: 400_000,
        yearlyInsuranceCents: 150_000,
      },
      opts(),
    );
    const short = await loadHomeEquity(id, opts());
    expect(short.escrow).toMatchObject({ kind: "short" });
    expect(short.escrowLetter).toBeNull();
    const { reply: r2 } = await sendToJane(id, "is my escrow right?", { client, now: later() });
    expect(r2.body).toContain("expect your payment to go up");
    expect(parseActions(r2.actions).map((a) => a.id)).toEqual(["open"]);
  });

  it("compares a HELOC, a cash-out refinance and a personal loan with total cost, in demo advice only", async () => {
    const id = await demoPerson("eq-project");
    // The demo bank has its own home; give it a value that leaves room to borrow against.
    await client.ownedAsset.updateMany({
      where: { userId: id, kind: "home" },
      data: { valueCents: 45_000_000 },
    });
    const c = (await compareHomeProject(id, { projectCents: 4_000_000, years: 10 }, opts()))!;
    expect(c.options.map((o) => o.product)).toEqual(["heloc", "cash_out", "personal"]);
    expect(c.options.every((o) => o.available && o.totalCostCents > 0)).toBe(true);
    const { reply } = await sendToJane(id, "HELOC or cash-out refinance for a $40,000 kitchen?", {
      client,
      now: later(),
    });
    expect(reply.body).toMatch(
      /^For \$40,000\.00 of work over 10 years, the HELOC has the lowest total cost/,
    );
    expect(reply.body).toContain("total cost");
    expect(reply.body).toContain("stand-in lender terms, not offers");
    expect(parseRefs(reply.refs).advice).toBe(true);
    const tool = JSON.parse(
      (await runChatTool(id, "home_equity", { project_cents: 4_000_000, years: 10 }, opts()))
        .content,
    );
    expect(tool.projectComparison.options).toHaveLength(3);
    expect(tool.projectComparison.standInLenderTermsNotOffers).toBe(true);
    await expect(compareHomeProject(id, { projectCents: 5, years: 10 }, opts())).rejects.toThrow(
      HomeEquityError,
    );
    await expect(
      compareHomeProject(id, { projectCents: 4_000_000, years: 99 }, opts()),
    ).rejects.toThrow(HomeEquityError);
    // A home worth less than the loans together won't back a bigger project.
    const big = (await compareHomeProject(id, { projectCents: 15_000_000, years: 10 }, opts()))!;
    expect(big.options[0].available).toBe(false);
  });

  it("has nothing for a real account without a mortgage, and refuses a bad bill", async () => {
    const user = await client.user.create({
      data: { email: `eq-real-${crypto.randomUUID()}@example.com` },
    });
    created.push(user.id);
    expect((await loadHomeEquity(user.id, opts())).available).toBe(false);
    expect(
      await compareHomeProject(user.id, { projectCents: 4_000_000, years: 10 }, opts()),
    ).toBeNull();
    const { reply } = await sendToJane(user.id, "is my escrow too high?", { client, now: later() });
    expect(reply.body).toMatch(/^I don't see a mortgage with a balance/);
    await expect(
      saveHomeFacts(
        user.id,
        {
          originalValueCents: -5,
          yearlyTaxCents: null,
          yearlyInsuranceCents: null,
        },
        opts(),
      ),
    ).rejects.toThrow(HomeEquityError);
    await markHomeRequestSent(user.id, "pmi", opts());
    expect(
      (await client.homeEquityFacts.findUnique({ where: { userId: user.id } }))?.pmiLetterSentOn,
    ).toEqual(new Date("2026-10-18T00:00:00Z"));
  });
});
