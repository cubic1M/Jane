import { randomBytes } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/db", async () => {
  const { PrismaClient: Client } = await import("@/generated/prisma/client");
  const { PrismaPg: Adapter } = await import("@prisma/adapter-pg");
  return {
    db: new Client({ adapter: new Adapter({ connectionString: process.env.TEST_DATABASE_URL }) }),
  };
});
vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));

import { loadTaxesArea } from "@/lib/area-pages/taxes-load";
import { loadAuditRecords } from "@/lib/audit-records";
import { loadBusinessStructure } from "@/lib/business-structure";
import { loadHubAreas } from "@/lib/hub/load";
import { tilesView } from "@/lib/hub/view";
import { createCheckPerson, deleteCheckPerson } from "@/lib/jane-agent/checks/person";
import { loadTaxSnapshot } from "@/lib/jane-agent/snapshot-tax";
import { answerTaxIntent } from "@/lib/jane-agent/tax-answer";
import { runTaxTool } from "@/lib/jane-agent/tax-tools-run";
import { loadSelfEmployed, saveMiles } from "@/lib/self-employed";
import { loadTaxEstimate } from "@/lib/tax-estimate";

// Tax T32b: tax year 2027 on the surfaces, with a frozen clock. Jane has every 2027 figure but the
// IRS business mileage rate, which is not published: everything prices with 2027 law, and only the
// mileage figure says so (the W-N sentence, no dollar figure). 2026 is unchanged until May 1.
const url = process.env.TEST_DATABASE_URL;
const MADE = new Date("2027-01-10T18:00:00Z");
const JAN15 = new Date("2027-01-15T18:00:00Z");
const MAY2 = new Date("2027-05-02T18:00:00Z");
const MILEAGE_W_N =
  "Jane doesn't have the IRS's 2027 mileage rate yet, so it hasn't counted those miles.";
const NO_YEAR = "Jane doesn't have the IRS figures for";
const $ = (dollars: number) => Math.round(dollars * 100);
// Every standard deduction a person can have in each year (single, joint, head of household, each
// with the extra amount for age 65 or older where it applies): the two sets share no figure.
const STANDARD_2027 = [$(16_600), $(18_700), $(33_200), $(36_600), $(24_925), $(27_025)];
const STANDARD_2026 = [$(16_100), $(18_150), $(32_200), $(35_500), $(24_150), $(26_200)];

describe.runIf(url)("tax year 2027 on every surface", { timeout: 240_000 }, () => {
  let client: PrismaClient;
  let freelancer: string;
  let retiring: string;

  beforeAll(async () => {
    vi.stubEnv("TOKEN_ENCRYPTION_KEY", randomBytes(32).toString("base64"));
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url! }) });
    freelancer = await createCheckPerson({ client, now: MADE, person: "freelancer" });
    retiring = await createCheckPerson({ client, now: MADE, person: "preretire" });
  });

  afterAll(async () => {
    for (const id of [freelancer, retiring]) {
      if (id) await deleteCheckPerson(id, { client }).catch(() => {});
    }
    await client.$disconnect();
    vi.unstubAllEnvs();
  });

  describe("January 15, 2027 (the default tax year is still 2026)", () => {
    it("the estimate shows 2026, with 2026 figures, unchanged", async () => {
      const view = await loadTaxEstimate(freelancer, { client, now: JAN15 });
      expect(view.year).toBe(2026);
      expect(view.estimate.year).toBe(2026);
      expect(STANDARD_2026).toContain(view.estimate.deduction.standardCents);
      expect(STANDARD_2027).not.toContain(view.estimate.deduction.standardCents);
    });

    it("an estimate asked for 2027 is priced with 2027's own figures", async () => {
      const view = await loadTaxEstimate(freelancer, { client, now: JAN15, year: 2027 });
      expect(view.year).toBe(2027);
      expect(view.estimate.year).toBe(2027);
      expect(STANDARD_2027).toContain(view.estimate.deduction.standardCents);
    });

    it("2026's miles are still priced at 2026's rate (72.5 cents to June 30)", async () => {
      await saveMiles(freelancer, 1_000, {
        client,
        now: new Date("2026-12-10T18:00:00Z"),
        via: "page",
      });
      const v = await loadSelfEmployed(freelancer, { client, now: JAN15 });
      expect(v.year).toBe(2026);
      expect(v.mileage).toEqual({ miles: 1_000, deductionCents: 72_500, awaited: null });
    });

    it("the health section prices the calendar year with 2027's limits: HSA $10,000 for family cover, $5,500 self-only, standard deduction $33,200", async () => {
      const out = JSON.stringify(
        await runTaxTool(retiring, "tax_health", {}, { client, now: JAN15 }),
      );
      expect(out).not.toContain(NO_YEAR);
      expect(out).toContain("$10,000.00");
      expect(out).toContain("self-only limit is $5,500.00");
      expect(out).toContain("$33,200.00");
      // 2026's would be $9,750, $5,400 and $32,200.
      expect(out).not.toContain("$9,750.00");
      expect(out).not.toContain("$32,200.00");
    });

    it("miles added in January are quoted for the year they are saved to (2027), not the page's 2026", async () => {
      const reply = await answerTaxIntent(
        freelancer,
        { kind: "tax", ask: "miles", miles: 40 } as never,
        { client, now: JAN15 } as never,
      );
      expect(reply.body).toContain(MILEAGE_W_N);
      expect(reply.body).not.toMatch(/\$\d/);
      // Saved for 2027, the year quoted: the 2026 record is replaced, not added to.
      expect(await saveMiles(freelancer, 40, { client, now: JAN15, via: "chat", add: true })).toBe(
        40,
      );
      const stored = await client.taxProfile.findFirst({ where: { userId: freelancer } });
      expect(stored?.businessMilesYear).toBe(2027);
    });

    it("the retirement section prices 2027 (the Medicare surcharge it sets is for 2029)", async () => {
      const out = JSON.stringify(
        await runTaxTool(retiring, "tax_retirement", {}, { client, now: JAN15 }),
      );
      expect(out).not.toContain(NO_YEAR);
      expect(out).toContain('\\"setsPremiumsFor\\":2029');
    });
  });

  describe("May 2, 2027 (the default tax year is 2027)", () => {
    beforeAll(async () => {
      // 1,200 business miles in 2027, as the miles box or the chat saves them.
      await saveMiles(freelancer, 1_200, {
        client,
        now: new Date("2027-05-01T18:00:00Z"),
        via: "page",
      });
    });

    it("the estimate, the Taxes page, the Home tile and the chat show 2027", async () => {
      const view = await loadTaxEstimate(freelancer, { client, now: MAY2 });
      expect(view.year).toBe(2027);
      expect(view.estimate.year).toBe(2027);
      expect(STANDARD_2027).toContain(view.estimate.deduction.standardCents);

      expect((await loadTaxesArea(freelancer, { now: MAY2 })).year).toBe(2027);

      const areas = await loadHubAreas(
        freelancer,
        { budgetsOver: 0, safeShort: false },
        { client, now: MAY2 },
      );
      const tile = tilesView(areas).find((t) => t.key === "taxes");
      expect(tile?.caption ?? "").not.toContain(NO_YEAR);

      const out = JSON.stringify(
        await runTaxTool(freelancer, "tax_estimate", {}, { client, now: MAY2 }),
      );
      expect(out).not.toContain(NO_YEAR);
      expect(out).toContain('\\"year\\":2027');

      const snapshot = await loadTaxSnapshot(freelancer, { client, now: MAY2 });
      expect(snapshot.taxNoParams).toBeUndefined();
      expect(snapshot.tax).not.toBeNull();
    });

    it("the estimate leaves the miles out and says so; the rest of it is priced", async () => {
      const view = await loadTaxEstimate(freelancer, { client, now: MAY2 });
      expect(view.assumptions).toContain(MILEAGE_W_N);
      expect(view.estimate.totalTaxCents).toBeGreaterThan(0);
    });

    it("a freelancer with 2027 miles keeps every figure but the mileage deduction", async () => {
      const v = await loadSelfEmployed(freelancer, { client, now: MAY2 });
      expect(v.year).toBe(2027);
      expect(v.mileage).toEqual({ miles: 1_200, deductionCents: 0, awaited: MILEAGE_W_N });
      expect(v.estimate.estimate.year).toBe(2027);
      expect(v.federal.payments.length).toBeGreaterThan(0);
      expect(v.setAsideRate).toBeGreaterThan(0);
      const business = await loadBusinessStructure(freelancer, { client, now: MAY2 });
      expect(business.mileage).toMatchObject({
        miles: 1_200,
        deductionCents: 0,
        awaited: MILEAGE_W_N,
      });
    });

    it("the chat tool and the miles answers carry the sentence and no dollar figure for the miles", async () => {
      const out = JSON.stringify(
        await runTaxTool(freelancer, "tax_self_employed", {}, { client, now: MAY2 }),
      );
      expect(out).toContain(MILEAGE_W_N);
      expect(out).not.toContain(NO_YEAR);
      const reply = await answerTaxIntent(
        freelancer,
        { kind: "tax", ask: "miles", miles: null } as never,
        { client, now: MAY2 } as never,
      );
      expect(reply.body).toContain(MILEAGE_W_N);
      expect(reply.body).not.toMatch(/\$\d/);
    });

    it("the audit records have no mileage line: no rate, so no dollar figure", async () => {
      const records = await loadAuditRecords(freelancer, 2027, { client, now: MAY2 });
      expect(records.items.map((i) => i.key)).not.toContain("mileage");
    });
  });
});
