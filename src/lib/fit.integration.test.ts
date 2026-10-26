import { randomBytes } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import type { PlaidApi } from "plaid";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));

import { runChatTool } from "@/lib/jane-agent/claude-tools";
import { sendToJane } from "@/lib/jane-agent/typing";
import { linkDemoBank } from "@/lib/plaid/demo";
import { syncItem } from "@/lib/plaid/sync";
import { loadDecisionInput } from "./debt-decisions";
import { loadFit } from "./fit";
import { detectFor } from "./suggestions";

// Spec step 283 against a real, migrated Postgres, on Chris's and the Reyes' demo banks: the
// fit engine's options for each need, and the same pick in the chat, Claude's tool and the
// debt decisions.

const url = process.env.TEST_DATABASE_URL;
const NOW = new Date("2026-10-18T15:00:00Z");
const MINUTE = 60 * 1000;

describe.runIf(url)("the fit engine against a real database", { timeout: 120_000 }, () => {
  let client: PrismaClient;
  let chris: string;
  let reyes: string;
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

  beforeAll(async () => {
    vi.stubEnv("TOKEN_ENCRYPTION_KEY", randomBytes(32).toString("base64"));
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    vi.stubEnv("PLAID_CLIENT_ID", "");
    vi.stubEnv("PLAID_SECRET", "");
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
    const make = async (person: "debt" | "family") => {
      const user = await client.user.create({
        data: { email: `fit-${person}-${crypto.randomUUID()}@example.com` },
      });
      created.push(user.id);
      const { itemId } = await linkDemoBank(user.id, { client, now: NOW, person });
      await syncItem(itemId, { client, api: plaid, now: NOW });
      return user.id;
    };
    chris = await make("debt");
    reyes = await make("family");
  }, 180_000);
  afterAll(async () => {
    await client.user.deleteMany({ where: { id: { in: created } } });
    await client.$disconnect();
    vi.unstubAllEnvs();
  });

  it("prices a car for the Reyes: two to four options, a pick, a confidence", async () => {
    const v = await loadFit(reyes, { need: "car", amountCents: 2_500_000 }, { client, now: NOW });
    expect(v.available).toBe(true);
    expect(v.options.length).toBeGreaterThanOrEqual(2);
    expect(v.options.length).toBeLessThanOrEqual(4);
    expect(v.options.map((o) => o.id)).toContain(v.pick);
    expect(v.confidence!.percent).toBeLessThanOrEqual(75);
    expect(v.advice).toBe(true);
  });

  it("works out Chris's consolidation and refinance against what he pays now", async () => {
    const c = await loadFit(chris, { need: "consolidation" }, { client, now: NOW });
    expect(c.baseline!.balanceCents).toBe(1_009_000);
    expect(c.amountCents).toBe(1_009_000);
    const r = await loadFit(chris, { need: "refinance" }, { client, now: NOW });
    expect(r.baseline).not.toBeNull();
    // Whatever is picked for someone in debt trouble is never a bigger payment than they have.
    const pick = r.options.find((o) => o.id === r.pick)!;
    if (r.pick !== "keep" && pick)
      expect(pick.paymentCents).toBeLessThanOrEqual(r.baseline!.monthlyCents);
  });

  it("finds nothing that fits Chris, says why and what would help, in the chat and the tool", async () => {
    const v = await loadFit(chris, { need: "consolidation" }, { client, now: NOW });
    expect(v.options).toEqual([]);
    expect(v.ineligible[0].reason).toMatch(
      /Lenders usually want a score of 600 or more for this; yours is \d+\./,
    );
    expect(v.whatWouldHelp[0]).toMatch(/^A score of 600 would open this up/);
    const tool = JSON.parse(
      (await runChatTool(chris, "loan_fit", { need: "consolidation" }, { client, now: NOW }))
        .content,
    );
    expect(tool.note).toBe("Nothing fits right now.");
    const { reply } = await sendToJane(chris, "which loan should I get to consolidate my cards?", {
      client,
      now: later(),
    });
    expect(reply.body).toMatch(
      /^Nothing fits for consolidating your debt right now: Lenders usually want a score of 600/,
    );
    expect((await loadDecisionInput(chris, { client, now: NOW })).personalLoan).toBeNull();
  });

  // Loans QA: the suggestion brought unasked follows the options card, priced by the same score
  // band and against the same card minimums. Books QA (#600): a typical month leaves their flood
  // repairs out of spending. Loans QA (one cash rule): their cash still sits inside the 3-month
  // emergency cushion, so the cards aren't paid from savings; one cheaper loan is the pick, and
  // the suggestion says the same saving.
  it("follows the options card for the Reyes, to the cent, with the cushion kept", async () => {
    const card = await loadFit(reyes, { need: "consolidation" }, { client, now: NOW });
    const pick = card.options.find((o) => o.id === card.pick)!;
    expect(card.pick).not.toBe("payoff");
    expect(card.cushionCents).toBeGreaterThan(0);
    const { suggestions } = await detectFor(reyes, { client, now: NOW });
    const s = suggestions.find((x) => x.topic === "consolidation")!;
    expect(s).toBeDefined();
    expect(s.worthCents).toBe(pick.savesCents);
    expect(s.why).toContain(pick.lender);
  });

  // Loans QA: a follow-up to the consolidation suggestion may come without a need.
  it("prices the cards as one loan when Claude's tool is asked with no need", async () => {
    const tool = JSON.parse(
      (await runChatTool(reyes, "loan_fit", {}, { client, now: NOW })).content,
    );
    expect(tool.error).toBeUndefined();
    expect(tool.need).toBe("consolidation");
  });

  it("is the same pick in the chat, Claude's tool and the debt decisions", async () => {
    const v = await loadFit(reyes, { need: "consolidation" }, { client, now: NOW });
    expect(v.pick).not.toBeNull();
    const tool = JSON.parse(
      (await runChatTool(reyes, "loan_fit", { need: "consolidation" }, { client, now: NOW }))
        .content,
    );
    expect(tool.pick).toBe(v.pick);
    expect(tool.options.map((o: { id: string }) => o.id)).toEqual(v.options.map((o) => o.id));
    const { reply } = await sendToJane(reyes, "which loan should I get to consolidate my cards?", {
      client,
      now: later(),
    });
    expect(reply.body).toContain(v.options.find((o) => o.id === v.pick)!.headline);
    const input = await loadDecisionInput(reyes, { client, now: NOW });
    const fitted = v.options.find((o) => o.id !== "keep" && o.id !== "payoff");
    if (fitted && (fitted.savesCents ?? 0) > 0) {
      expect(input.personalLoan).toMatchObject({
        name: fitted.lender,
        aprBps: fitted.aprBps,
        savesCents: fitted.savesCents,
      });
    } else {
      expect(input.personalLoan).toBeNull();
    }
  });

  it("answers the best-loan question in the chat with the pick, how sure, and the options", async () => {
    const { reply } = await sendToJane(reyes, "what's the best car loan for $25,000?", {
      client,
      now: later(),
    });
    expect(reply.body).toMatch(
      /^For a car loan of \$25,000\.00, the one that fits you best: .+ - \$[\d,.]+ a month for \d(\.\d)? yrs?\. \d+% sure: /,
    );
    expect(reply.body).toContain("Your options:");
    expect(reply.body.match(/\(my pick\)/g)).toHaveLength(1);
  });

  it("says what it can't do for a person with nothing to borrow against", async () => {
    const user = await client.user.create({
      data: { email: `fit-none-${crypto.randomUUID()}@example.com` },
    });
    created.push(user.id);
    const v = await loadFit(user.id, { need: "consolidation" }, { client, now: NOW });
    expect(v.options).toEqual([]);
    const { reply } = await sendToJane(
      user.id,
      "which loan should I get to consolidate my cards?",
      {
        client,
        now: later(),
      },
    );
    expect(reply.body).not.toMatch(/my pick/);
  });
});
