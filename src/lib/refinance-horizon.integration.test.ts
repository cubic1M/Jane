import { randomBytes } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import type { PlaidApi } from "plaid";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));

import { PEOPLE, type PersonId } from "@/config/people";
import { linkDemoBank } from "@/lib/plaid/demo";
import { syncItem } from "@/lib/plaid/sync";
import { loadFit } from "./fit";
import { ensureChecked, loadRefinance } from "./refinance";

// Loans QA against a real database, for the eight sample people and the default demo person:
// the offers page (step 111) and the loan options card (the fit engine) compare a refinance over
// one horizon, the debt's own remaining months against keeping it, so a pick shows the same
// lender and the same saving in both, and one rule for paying a debt off from cash.

const url = process.env.TEST_DATABASE_URL;
const NOW = new Date("2026-10-18T15:00:00Z");

describe.runIf(url)("one refinance horizon on the offers page and the options card", () => {
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

  beforeAll(() => {
    vi.stubEnv("TOKEN_ENCRYPTION_KEY", randomBytes(32).toString("base64"));
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    vi.stubEnv("PLAID_CLIENT_ID", "");
    vi.stubEnv("PLAID_SECRET", "");
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  });
  afterAll(async () => {
    await client.user.deleteMany({ where: { id: { in: created } } });
    await client.$disconnect();
    vi.unstubAllEnvs();
  });

  for (const who of [undefined, ...PEOPLE.map((p) => p.id)] as (PersonId | undefined)[]) {
    it(`agrees for ${who ?? "the default demo person"}`, { timeout: 120_000 }, async () => {
      const user = await client.user.create({
        data: { email: `horizon-${who ?? "demo"}-${crypto.randomUUID()}@example.com` },
      });
      created.push(user.id);
      const opts = { client, now: NOW };
      const { itemId } = await linkDemoBank(user.id, { ...opts, person: who });
      await syncItem(itemId, { client, api: plaid, now: NOW });
      await ensureChecked(user.id, opts);
      const refi = await loadRefinance(user.id, opts);
      for (const c of refi.comparisons) {
        const fit = await loadFit(user.id, { need: "refinance", debtKey: c.debtKey }, opts);
        const pick = fit.options.find((o) => o.id === fit.pick);
        // Keeping it costs the same in both.
        expect(fit.baseline?.monthlyCents, c.debtName).toBe(c.currentMonthlyCents);
        // One cash rule for every kind of debt: where the options card pays it off from cash,
        // the page does too, and it keeps the emergency cushion.
        if (fit.pick === "payoff") {
          expect(c.cashPayoffCents, c.debtName).toBe(pick!.savesCents);
          expect(c.pick, c.debtName).toBeNull();
        } else {
          expect(c.cashPayoffCents ?? null, c.debtName).toBeNull();
        }
        if (c.pick) {
          // The same lender, over the debt's own months, with the same saving to the cent.
          expect(pick?.lender, c.debtName).toBe(c.pick.offer.lender);
          expect(pick?.termMonths, c.debtName).toBe(c.termMonths);
          expect(pick?.savesCents, c.debtName).toBe(c.pick.savingCents);
        } else if (pick && pick.id !== "keep" && pick.id !== "payoff") {
          // The options card picks a loan only where the page does.
          throw new Error(`${c.debtName}: the options card picks ${pick.lender}, the page none`);
        }
      }
    });
  }
});
