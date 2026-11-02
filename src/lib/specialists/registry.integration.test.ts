import { randomBytes } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { SPECIALIST_KEYS, SPECIALISTS } from "@/config/specialists";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));

import { linkDemoBank } from "@/lib/plaid/demo";
import { isSimulated, realSpecialistOn, specialistsFor } from "./registry";

// One registry of specialists: what each does, stand-in or real, on or off for this person.

const url = process.env.TEST_DATABASE_URL;

describe("the list of specialists", () => {
  it("has one entry for each key, each saying what it does and who'd hold the license", () => {
    expect(SPECIALISTS.map((s) => s.key).sort()).toEqual([...SPECIALIST_KEYS].sort());
    for (const s of SPECIALISTS) {
      expect(s.does, s.key).toMatch(/\.$/);
      expect(s.licenseHolder, s.key).toBeTruthy();
    }
  });

  it("no real specialist is on until its flag is", () => {
    for (const key of SPECIALIST_KEYS) expect(realSpecialistOn(key), key).toBe(false);
  });

  it("every stand-in is simulated; so is the email agent with no real mail set up", () => {
    for (const key of SPECIALIST_KEYS) expect(isSimulated(key, "u"), key).toBe(true);
  });

  // A new connector can't be added without a place here.
  it("covers every partner interface in src/lib", () => {
    const COVERED: Record<string, string> = {
      MoneyMovementPartner: "money_movement",
      BrokeragePartner: "brokerage",
      PayrollPartner: "payroll",
      FilingPartner: "filing",
      TaxPaymentPartner: "tax_payments",
      TaxDocumentPartner: "tax_documents",
      CreditPartner: "credit_report",
      CreditCardPartner: "credit_cards",
      LenderPartner: "lenders",
      InsurancePartner: "insurance",
      DonorFundPartner: "donor_fund",
      PropertyPartner: "property_records",
      MarketDataPartner: "market_data",
      // Not a connector: a referral's name and disclosure on a card.
      CardPartner: "credit_cards",
    };
    const walk = (dir: string): string[] =>
      readdirSync(dir).flatMap((name) => {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) return walk(path);
        return /\.ts$/.test(name) && !/\.test\.ts$/.test(name) ? [path] : [];
      });
    const found = new Set(
      walk("src/lib").flatMap((path) =>
        [
          ...readFileSync(path, "utf8").matchAll(
            /export (?:interface|type) (\w+Partner)\b(?: =)? *\{/g,
          ),
        ].map((m) => m[1]),
      ),
    );
    for (const name of found) {
      expect(COVERED[name], `${name} isn't in src/config/specialists.ts`).toBeTruthy();
    }
    for (const key of Object.values(COVERED)) expect(SPECIALIST_KEYS).toContain(key);
  });
});

describe.runIf(url)("for one person", { timeout: 120_000 }, () => {
  let client: PrismaClient;
  const created: string[] = [];
  beforeAll(() => {
    vi.stubEnv("TOKEN_ENCRYPTION_KEY", randomBytes(32).toString("base64"));
    vi.stubEnv("PLAID_CLIENT_ID", "");
    vi.stubEnv("PLAID_SECRET", "");
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url! }) });
  });
  afterAll(async () => {
    await client.user.deleteMany({ where: { id: { in: created } } });
    await client.$disconnect();
    vi.unstubAllEnvs();
  });
  const person = async () => {
    const user = await client.user.create({
      data: { email: `registry-${crypto.randomUUID()}@example.com` },
    });
    created.push(user.id);
    return user.id;
  };

  it("all on and all simulated on the demo bank", async () => {
    const userId = await person();
    await linkDemoBank(userId, { client, now: new Date("2026-10-18T15:00:00Z") });
    const all = await specialistsFor(userId, { client });
    expect(all).toHaveLength(SPECIALISTS.length);
    expect(all.every((s) => s.on && s.simulated)).toBe(true);
  });

  it("all off on a real account", async () => {
    const userId = await person();
    await client.account.create({
      data: { userId, source: "csv", name: "Checking", type: "depository" },
    });
    expect((await specialistsFor(userId, { client })).some((s) => s.on)).toBe(false);
  });
});
