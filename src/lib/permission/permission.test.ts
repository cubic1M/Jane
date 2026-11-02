import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { SPECIALISTS, type SpecialistKey } from "@/config/specialists";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn(), getCurrentUser: vi.fn() }));

import { sendAgentMail } from "@/lib/agent/mail";
import { simulatedBrokerage } from "@/lib/brokerage/partner";
import { demoCreditCards } from "@/lib/credit-cards/demo";
import { demoDonorFund } from "@/lib/donor-fund/demo";
import { demoFilingPartner } from "@/lib/filing/demo";
import { demoPartner } from "@/lib/insurance/demo-partner";
import { demoLender } from "@/lib/lenders/demo";
import { standInPartner } from "@/lib/money-movement/partner";
import { standInPayroll } from "@/lib/payroll/partner";
import { demoTaxPaymentPartner } from "@/lib/tax-payments/demo";
import { gated, NoPermission, withGrant } from "./gate";

// Nothing can act without the permission check: a connector's acting methods throw outside a grant,
// only the check hands out grants, and every line that calls one is in a file that goes through it.

const none = {} as never;

const ACTS: readonly [string, SpecialistKey, () => unknown][] = [
  ["money movement schedule", "money_movement", () => standInPartner.schedule(none)],
  ["brokerage orders", "brokerage", () => simulatedBrokerage.placeOrders("u", none, none)],
  ["payroll contribution", "payroll", () => standInPayroll.requestContributionChange(none)],
  ["payroll allocation", "payroll", () => standInPayroll.requestAllocationChange(none)],
  ["filing", "filing", () => demoFilingPartner.submitReturn("r", none)],
  ["tax payment", "tax_payments", () => demoTaxPaymentPartner.pay(none)],
  ["donor fund", "donor_fund", () => demoDonorFund.openFund(none)],
  ["loan apply", "lenders", () => demoLender.apply(none)],
  ["loan accept", "lenders", () => demoLender.accept("a")],
  ["card apply", "credit_cards", () => demoCreditCards.apply(none)],
  ["insurance bind", "insurance", () => demoPartner.bind(none, none)],
  ["insurance cancel", "insurance", () => demoPartner.cancel(none, none)],
  ["life application", "insurance", () => demoPartner.applyLife(none, none)],
  ["policy change", "insurance", () => demoPartner.endorse(none, none, none)],
  ["renewal call", "insurance", () => demoPartner.negotiateRenewal(none, none)],
  ["claim", "insurance", () => demoPartner.fileClaim(none, none)],
  ["policy saving", "insurance", () => demoPartner.applySaving(none, none, none)],
  ["email agent", "email_agent", () => sendAgentMail(none)],
];

describe("a connector outside the permission check", () => {
  it.each(ACTS)("%s can't act", async (_name, _key, act) => {
    await expect(async () => act()).rejects.toThrow(NoPermission);
  });

  it.each(ACTS)("%s won't take another specialist's grant", async (_name, key, act) => {
    const other = key === "brokerage" ? "payroll" : "brokerage";
    await expect(withGrant({ specialist: other, userId: "u" }, async () => act())).rejects.toThrow(
      NoPermission,
    );
  });

  it("every acting specialist has a connector or a door here", () => {
    const covered = new Set(ACTS.map(([, key]) => key));
    // The phone agent has no connector yet: its one act is a job started inside the check.
    const acting = SPECIALISTS.filter((s) => s.access === "acts" && s.key !== "phone_agent");
    for (const s of acting) expect(covered.has(s.key), s.key).toBe(true);
  });

  it("can still read, and can always take something back", async () => {
    await expect(standInPartner.settled({ runOn: "2026-01-01" }, "2026-01-02")).resolves.toBe(true);
    await expect(standInPartner.cancel("x")).resolves.toBe(true);
    expect(standInPartner.name).toBeTruthy();
  });

  it("gated keeps the connector's own interface and this", async () => {
    const partner = gated(
      "brokerage",
      {
        n: 2,
        twice(this: { n: number }) {
          return this.n * 2;
        },
        async act(this: { n: number }) {
          return this.n * 3;
        },
      },
      ["act"],
    );
    expect(partner.n).toBe(2);
    expect(partner.twice()).toBe(4);
    await expect(
      withGrant({ specialist: "brokerage", userId: "u" }, () => partner.act()),
    ).resolves.toBe(6);
  });
});

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === "generated" ? [] : sourceFiles(path);
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

describe("in the code", () => {
  const files = sourceFiles("src").map((path) => ({ path, text: readFileSync(path, "utf8") }));

  it("only the check hands out grants", () => {
    const using = files
      .filter((f) => /\bwithGrant\b/.test(f.text))
      .map((f) => f.path)
      .sort();
    expect(using).toEqual(["src/lib/permission/check.ts", "src/lib/permission/gate.ts"].sort());
    // Tests may stand in for it, nothing else.
  });

  it("every call to a connector's act is in a file that goes through the check", () => {
    const ACT =
      /\.(placeOrders|requestContributionChange|requestAllocationChange|submitReturn|applyLife|endorse|negotiateRenewal|fileClaim|applySaving|openFund)\(|\b(?:movement|partner)\.schedule\(|\b(?:binding)\.(?:bind|cancel)\(|\bfound\.partner\.(?:apply|accept)\(|\bpartner\.pay\(|\bsendAgentMail\(/;
    const callers = files.filter((f) => ACT.test(f.text));
    expect(callers.length).toBeGreaterThan(10);
    for (const f of callers) {
      // Where they're defined, and the check's own helper.
      if (/\/(demo|partner|types|demo-partner|mail)\.ts$/.test(f.path)) continue;
      expect(/throughPermission|placeThrough/.test(f.text), f.path).toBe(true);
    }
  });
});
