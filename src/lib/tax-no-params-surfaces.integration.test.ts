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
import { NoParamsPage } from "@/app/taxes/no-params";
import { loadHubAreas } from "@/lib/hub/load";
import { tilesView } from "@/lib/hub/view";
import { createCheckPerson, deleteCheckPerson } from "@/lib/jane-agent/checks/person";
import { taxesSource } from "@/lib/jane-agent/sources/taxes";
import { loadTaxSnapshot } from "@/lib/jane-agent/snapshot-tax";
import { runTaxTool } from "@/lib/jane-agent/tax-tools-run";
import { loadTaxEstimate } from "@/lib/tax-estimate";
import { noParamsText } from "@/lib/tax-estimate-state";
import { loadTaxSetAsideIfPriced } from "@/lib/tax-set-aside";

// Tax T4 (4): a figure shown as the tax of a specific year is never priced with another year's law.
// From May 1, 2027 the usual tax year is 2027, which has no parameter file: every surface says the
// W-N sentence and carries no dollar figure for it, and 2026 is unchanged until then.
const url = process.env.TEST_DATABASE_URL;
const CREATED = new Date("2026-11-05T23:00:00Z");
const DEC31 = new Date("2026-12-31T20:00:00Z");
const JAN1 = new Date("2027-01-01T20:00:00Z");
const APR30 = new Date("2027-04-30T22:00:00Z");
const MAY1 = new Date("2027-05-01T19:00:00Z");
const W_N = "Jane doesn't have the IRS figures for 2027 yet, so it isn't estimating that year.";

describe.runIf(url)("a year with no IRS figures, on every surface", { timeout: 180_000 }, () => {
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

  it("the loader refuses 2027 instead of borrowing 2026 law", async () => {
    await expect(loadTaxEstimate(id, { client, now: MAY1 })).rejects.toBeInstanceOf(
      NoTaxParamsError,
    );
    expect(await loadTaxSetAsideIfPriced(id, { client, now: MAY1 })).toBeNull();
  });

  it("the Taxes page says the sentence and shows no money", () => {
    const html = renderToStaticMarkup(
      createElement(NoParamsPage, { user: {} as never, year: 2027 }),
    );
    expect(html).toContain("Jane doesn&#x27;t have the IRS figures for 2027 yet");
    expect(html).not.toMatch(/\$\d/);
  });

  it("Home's tax tile says the sentence and shows no figure", async () => {
    const areas = await loadHubAreas(id, { budgetsOver: 0, safeShort: false }, { client, now: MAY1 });
    const tile = tilesView(areas).find((t) => t.key === "taxes");
    expect(tile?.caption).toBe(W_N);
    expect(tile?.value).toBeNull();
  });

  it("the chat tool says no figures for the year, and carries no dollar figure", async () => {
    const out = await runTaxTool(id, "tax_estimate", {}, { client, now: MAY1 });
    const text = JSON.stringify(out);
    expect(text).toContain("Jane doesn't have the IRS figures for 2027 yet");
    expect(text).not.toMatch(/\$\d/);
  });

  it("the chat snapshot carries the state, and no tax card is posted from it", async () => {
    const snapshot = await loadTaxSnapshot(id, { client, now: MAY1 });
    expect(snapshot.taxNoParams).toEqual({ year: 2027 });
    expect(snapshot.tax).toBeNull();
    expect(taxesSource.gather(snapshot as never, {} as never)).toEqual([]);
    expect(noParamsText(2027)).toBe(W_N);
  });

  it("calendar sweep: 2026 figures are unchanged until the flip on May 1, 2027", async () => {
    const dec31 = await loadTaxEstimate(id, { client, now: DEC31 });
    const jan1 = await loadTaxEstimate(id, { client, now: JAN1 });
    const apr30 = await loadTaxEstimate(id, { client, now: APR30 });
    for (const view of [dec31, jan1, apr30]) {
      expect(view.year).toBe(2026);
      expect(view.estimate.year).toBe(2026);
    }
    expect(JSON.stringify(jan1.estimate)).toBe(JSON.stringify(dec31.estimate));
    expect(JSON.stringify(apr30.estimate)).toBe(JSON.stringify(dec31.estimate));
    // The next day it is 2027 and the figure is gone.
    await expect(loadTaxEstimate(id, { client, now: MAY1 })).rejects.toBeInstanceOf(
      NoTaxParamsError,
    );
  });
});
