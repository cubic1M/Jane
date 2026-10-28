import { readFileSync } from "node:fs";
import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn() }));

import { importPositionsFiles, previewPositionsFiles } from "./positions";
import { REAL_ACCOUNT_ADVICE } from "@/config/advice";
import { logAudit } from "@/lib/audit";
import { adviceMode } from "@/lib/advice-mode";
import { scopedFor } from "@/lib/db-scoped";
import { loadInvestments } from "@/lib/investments/holdings";
import { loadNetWorthHistory } from "@/lib/net-worth-history";
import { detectFor } from "@/lib/suggestions";

// Positions downloads against a real, migrated Postgres (see
// src/detection/engine.integration.test.ts). The files are made up, in each broker's layout.
const url = process.env.TEST_DATABASE_URL;
const NOW = new Date("2026-10-28T18:00:00Z");

const fixture = (name: string) =>
  readFileSync(
    new URL(`../../data-sources/csv/__fixtures__/positions/${name}`, import.meta.url),
    "utf8",
  );

// A Fidelity download holding a fund Jane's fund table knows a cheaper twin of (NSTDX, 0.75% a
// year, against KTRGX at 0.08%), and a lot of cash in the core position.
const FIDELITY = [
  "Account Number,Account Name,Symbol,Description,Quantity,Last Price,Last Price Change,Current Value,Today's Gain/Loss Dollar,Today's Gain/Loss Percent,Total Gain/Loss Dollar,Total Gain/Loss Percent,Percent Of Account,Cost Basis Total,Average Cost Basis,Type",
  "Z00000009,Individual,SPAXX**,HELD IN MONEY MARKET,,,,$40000.00,,,,,40.00%,,,Cash,",
  "Z00000009,Individual,NSTDX,TARGET DATE 2055 FUND,1000,$60.00,+$0.10,$60000.00,+$100.00,+0.17%,+$5000.00,+9.09%,60.00%,$55000.00,$55.00,Cash,",
  "",
  '"Date downloaded Oct-27-2026 9:00 a.m ET"',
].join("\n");

describe.runIf(url)("positions downloads, against a real database", () => {
  let client: PrismaClient;
  let userId: string;
  let otherId: string;

  beforeAll(async () => {
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
    const make = async (who: string) =>
      (
        await client.user.create({
          data: { email: `positions-${who}-${crypto.randomUUID()}@example.com` },
        })
      ).id;
    userId = await make("me");
    otherId = await make("other");
  });
  afterAll(async () => {
    await client.user.deleteMany({ where: { id: { in: [userId, otherId] } } });
    await client.$disconnect();
  });

  it("a Vanguard download shows on the investments page and in net worth", async () => {
    const db = scopedFor(userId, client);
    const files = [{ name: "ofxdownload.csv", text: fixture("vanguard.csv") }];

    const [preview] = await previewPositionsFiles(db, files);
    if (!preview.ok) throw new Error(preview.error);
    expect(preview.accounts.map((a) => [a.name, a.valueCents, a.replaces])).toEqual([
      ["Vanguard Account …0003", 2096056, false],
      ["Vanguard Account …0004", 1650000, false],
    ]);
    // A preview saves nothing.
    expect(await db.accounts.count()).toBe(0);

    const saved = await importPositionsFiles(db, files, {
      // The person says the second is a Roth IRA.
      subtypes: { "vanguard:00000004": "roth" },
      now: NOW,
    });
    expect(saved).toEqual({ ok: true, accounts: 2, holdings: 4, valueCents: 3746056 });
    expect(logAudit).toHaveBeenCalledWith(
      { type: "user", id: userId },
      "positions_imported",
      { type: "user", id: userId },
      { files: 1, accounts: 2, holdings: 4 },
    );

    const investments = await loadInvestments(userId, { client, now: NOW });
    expect(investments.totalCents).toBe(3746056);
    expect(investments.byKind).toEqual({ retirement: 1650000, investment: 2096056 });
    expect(investments.holdingCount).toBe(4);
    const [taxable] = investments.accounts.filter((a) => a.subtype === "brokerage");
    expect(taxable.holdingsMatch).toBe(true);
    expect(taxable.holdings.find((h) => h.ticker === "VMFXX")?.isCash).toBe(true);
    const vtsax = taxable.holdings.find((h) => h.ticker === "VTSAX");
    expect(vtsax?.valueCents).toBe(1690181);
    expect(vtsax?.source).toBe("Your upload, Vanguard Account …0003, price as of Oct 28, 2026");

    const worth = await loadNetWorthHistory(userId, { client, now: NOW });
    expect(worth?.todayCents).toBe(3746056);
    expect(worth?.known).toBe(true);
  });

  it("a newer download replaces the account's holdings instead of adding to them", async () => {
    const db = scopedFor(userId, client);
    // A month later: VTIAX sold into cash, the rest moved.
    const newer = fixture("vanguard.csv")
      .replace("1250.75,1.00,1250.75", "4058.75,1.00,4058.75")
      .replace(/^00000003,VANGUARD TOTAL INTL.*\n/m, "")
      .replace("120.512,140.25,16901.81", "120.512,142.00,17112.70");
    const [preview] = await previewPositionsFiles(db, [
      { name: "ofxdownload (1).csv", text: newer },
    ]);
    expect(preview.ok && preview.accounts.every((a) => a.replaces)).toBe(true);

    await importPositionsFiles(db, [{ name: "ofxdownload (1).csv", text: newer }], { now: NOW });

    expect(await db.accounts.count()).toBe(2);
    const investments = await loadInvestments(userId, { client, now: NOW });
    expect(investments.holdingCount).toBe(3);
    const [taxable] = investments.accounts.filter((a) => a.name.endsWith("0003"));
    expect(taxable.holdings.map((h) => [h.ticker, h.valueCents]).sort()).toEqual([
      ["VMFXX", 405875],
      ["VTSAX", 1711270],
    ]);
    expect(taxable.balanceCents).toBe(2117145);
    // The type the person picked stays when the newer file doesn't say one.
    expect(investments.accounts.find((a) => a.name.endsWith("0004"))?.subtype).toBe("roth");
    expect(preview.ok && preview.accounts[1].subtype).toBe("roth");
  });

  it("a file that doesn't read saves nothing at all", async () => {
    const db = scopedFor(otherId, client);
    const result = await importPositionsFiles(
      db,
      [
        { name: "Portfolio_Positions.csv", text: fixture("fidelity.csv") },
        {
          name: "chase.csv",
          text: "Transaction Date,Post Date,Description,Category,Type,Amount\n",
        },
      ],
      { now: NOW },
    );
    expect(result).toEqual({ ok: false, error: expect.stringMatching(/^chase\.csv: /) });
    expect(await db.accounts.count()).toBe(0);
    expect(await db.holdings.count()).toBe(0);
  });

  it("a real account's Fidelity holdings reach the investing checks, as facts", async () => {
    const db = scopedFor(otherId, client);
    await importPositionsFiles(db, [{ name: "Portfolio_Positions.csv", text: FIDELITY }], {
      now: NOW,
    });
    // Holdings are the person's own: nobody else's checks see them.
    expect(await scopedFor(userId, client).holdings.count()).toBe(3);

    expect(REAL_ACCOUNT_ADVICE).toBe(false);
    expect(await adviceMode(otherId, { client })).toBe(false);
    const { suggestions, advice } = await detectFor(otherId, { client, now: NOW });
    expect(advice).toBe(false);
    const fees = suggestions.find((s) => s.topic === "investment_fees");
    // $60,000 at 0.75% against 0.08%: $402 a year.
    expect(fees?.worthCents).toBe(40200);
    expect(fees?.why).toMatch(/\$60,000\.00/);
  });
});
