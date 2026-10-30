import { randomBytes } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import type { PlaidApi } from "plaid";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { ADVICE_TOPICS } from "@/config/suggestions";
import type { PersonId } from "@/config/people";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));

import { linkDemoBank } from "@/lib/plaid/demo";
import { syncItem } from "@/lib/plaid/sync";
import { detectFor } from "@/lib/suggestions";
import { decideTax } from "@/lib/tax-decisions";
import { loadTaxCalendar } from "@/lib/tax-calendar";
import { loadTaxFound } from "@/lib/tax-scan";
import { calendarReply } from "./tax-calendar-message";

// Taxes QA (2026-10-22): with a real account next to the demo bank, the chat held back its tax
// recommendations but the suggestion cards still said "Convert some pre-tax money to Roth",
// "Sell a holding at a loss" or "Ask about an S corporation"; in demo advice mode the same
// cards came without the demo label. And a self-employed person asking about a home office was
// told only that it's "for people who work for themselves".

const url = process.env.TEST_DATABASE_URL;
const NOW = new Date("2026-10-18T15:00:00Z");
const TAX_MOVES = [
  "roth_conversion",
  "childcare_tax_break",
  "year_end_moves",
  "property_tax_check",
  "tax_loss_harvest",
  "s_corp_election",
  "home_office_deduction",
  "social_security_tax",
];

describe.runIf(url)("tax recommendations and real accounts", { timeout: 300_000 }, () => {
  let client: PrismaClient;
  const created: string[] = [];
  const plaid = new Proxy(
    {},
    {
      get: () => () => {
        throw new Error("no plaid");
      },
    },
  ) as PlaidApi;
  async function person(id: PersonId, real: boolean) {
    const user = await client.user.create({
      data: { email: `qa-real-${id}-${crypto.randomUUID()}@example.com` },
    });
    created.push(user.id);
    const { itemId } = await linkDemoBank(user.id, { client, now: NOW, person: id });
    await syncItem(itemId, { client, api: plaid, now: NOW });
    // A CSV account next to the demo bank turns demo advice off (src/lib/advice-mode.ts).
    if (real)
      await client.account.create({
        data: {
          userId: user.id,
          source: "csv",
          name: "Credit union checking",
          type: "depository",
          currentBalanceCents: 100_000,
        },
      });
    return user.id;
  }

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

  it("lists every tax move as advice", () => {
    for (const t of TAX_MOVES) expect(ADVICE_TOPICS as readonly string[]).toContain(t);
  });

  it("gives tax moves to demo people as advice and none to real accounts", async () => {
    const people: PersonId[] = ["freelancer", "preretire", "owner", "retiree", "family"];
    const seen = new Set<string>();
    for (const id of people) {
      const demo = await detectFor(await person(id, false), { client, now: NOW });
      expect(demo.advice).toBe(true);
      for (const s of demo.suggestions) if (TAX_MOVES.includes(s.topic)) seen.add(s.topic);
      const real = await detectFor(await person(id, true), { client, now: NOW });
      expect(real.advice).toBe(false);
      expect(real.suggestions.length).toBeGreaterThan(0);
      expect(real.suggestions.filter((s) => TAX_MOVES.includes(s.topic))).toEqual([]);
    }
    // The walk found these on the sample people; the rest are covered by the list above. The home
    // office move isn't shown while its page is hidden in the beta (src/config/hidden-pages.ts).
    for (const t of ["roth_conversion", "s_corp_election"]) expect(seen).toContain(t);
  });

  it("puts tax moves on the calendar as demo advice, and none on a real account's", async () => {
    const demoId = await person("preretire", false);
    const demo = await loadTaxFound(demoId, { client, now: NOW });
    expect(demo.find((f) => f.topic === "roth_conversion")).toMatchObject({ advice: true });
    const calendar = await loadTaxCalendar(demoId, { client, now: NOW });
    const month = demo.filter((f) => f.month === calendar.month);
    expect(calendarReply(calendar, demo).refs.advice).toBe(
      month.some((f) => f.advice) ? true : undefined,
    );
    const real = await loadTaxFound(await person("preretire", true), { client, now: NOW });
    expect(real.length).toBeGreaterThan(0);
    expect(real.filter((f) => f.advice)).toEqual([]);
  });

  it("tells a self-employed real account the home office rule as a fact", async () => {
    const d = await decideTax(await person("freelancer", true), "home_office", {
      client,
      now: NOW,
    });
    expect(d.advice).toBe(false);
    expect(d.text).toContain("$5.00 a square foot, up to 300 square feet");
    expect(d.text).toContain("I see self-employment income in your accounts.");
    expect(d.text).toContain("I can only say what the numbers are, not what to do.");
  });
});
