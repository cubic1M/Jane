import { randomBytes } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));
vi.mock("@/components/app-header", () => ({ AppHeader: () => null }));

import { NoTaxParamsError } from "@/config/tax-params";
import { createCheckPerson, deleteCheckPerson } from "@/lib/jane-agent/checks/person";
import { NoParamsPage } from "@/app/taxes/no-params";
import { loadTaxEstimate } from "./tax-estimate";
import { loadRefunds } from "./tax-refund";
import { estimateState, noParamsText } from "./tax-estimate-state";

// Tax T4: a year Jane has no IRS figures for gets no estimate, never another year's. The default
// year is last year until the end of April (the person's own day), then this one.
const url = process.env.TEST_DATABASE_URL;
const CREATED = new Date("2026-11-05T23:00:00Z");
// The person's 3pm and 7pm on April 30, 2027 in Los Angeles: 7pm is already May 1 in UTC. It is
// still April 30 for the person, so the year gathered is still 2026 at both.
const APR30_3PM = new Date("2027-04-30T22:00:00Z");
const APR30_7PM = new Date("2027-05-01T02:00:00Z");
const MAY1_NOON = new Date("2027-05-01T19:00:00Z");
// Either side of the new year in the person's day: the default year stays 2026.
const DEC31 = new Date("2026-12-31T20:00:00Z");
const JAN1 = new Date("2027-01-01T20:00:00Z");

describe.runIf(url)("the estimate for a year with no IRS figures", { timeout: 180_000 }, () => {
  let client: PrismaClient;
  let id: string;

  beforeAll(async () => {
    vi.stubEnv("TOKEN_ENCRYPTION_KEY", randomBytes(32).toString("base64"));
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url! }) });
    id = await createCheckPerson({ client, now: CREATED, person: "retiree" });
  });

  afterAll(async () => {
    await deleteCheckPerson(id, { client }).catch(() => {});
    await client.$disconnect();
  });

  it("from May 1, 2027 the usual year is 2027 and has no figures: the estimate is refused, never priced with 2026 law", async () => {
    await expect(loadTaxEstimate(id, { client, now: MAY1_NOON })).rejects.toMatchObject({
      name: "NoTaxParamsError",
      year: 2027,
    });
    await expect(loadTaxEstimate(id, { client, now: CREATED, year: 2024 })).rejects.toBeInstanceOf(
      NoTaxParamsError,
    );
    expect(noParamsText(2027)).toBe(
      "Jane doesn't have the IRS figures for 2027 yet, so it isn't estimating that year.",
    );
    expect(
      estimateState({ noParams: true, totalTaxCents: 1, withholdingKnown: true, refundCents: 5 }),
    ).toBe("no_params");
  });

  it("a refund of tax year 2024 (deposited December 2025) leaves its match unknown instead of failing the load", async () => {
    const account = await client.account.findFirstOrThrow({ where: { userId: id } });
    await client.transaction.create({
      data: {
        userId: id,
        accountId: account.id,
        source: "csv",
        date: new Date("2025-12-20T00:00:00Z"),
        amountCents: -50_000,
        description: "IRS TREAS 310 TAX REF",
        pfcDetailed: "INCOME_TAX_REFUND",
      },
    });
    const { refunds } = await loadRefunds(id, { client, now: CREATED });
    const old = refunds.find((r) => r.refund.taxYear === 2024);
    expect(old?.match).toBeNull();
  });

  it("the page for that year says the sentence and shows no money", () => {
    const html = renderToStaticMarkup(
      createElement(NoParamsPage, { user: {} as never, year: 2027 }),
    );
    expect(html).toContain("Jane doesn&#x27;t have the IRS figures for 2027 yet");
    expect(html).not.toMatch(/\$\d/);
  });

  it("3pm and 7pm on April 30, 2027 are the same person's day: both still 2026, same figures", async () => {
    const three = await loadTaxEstimate(id, { client, now: APR30_3PM });
    const seven = await loadTaxEstimate(id, { client, now: APR30_7PM });
    expect(JSON.stringify(seven)).toBe(JSON.stringify(three));
    expect(three.year).toBe(2026);
  });

  it("across December 31 to January 1 the default year stays 2026 and its tax figures do not move", async () => {
    const dec31 = await loadTaxEstimate(id, { client, now: DEC31 });
    const jan1 = await loadTaxEstimate(id, { client, now: JAN1 });
    expect(dec31.year).toBe(2026);
    expect(jan1.year).toBe(2026);
    expect(JSON.stringify(jan1.estimate)).toBe(JSON.stringify(dec31.estimate));
  });
});
