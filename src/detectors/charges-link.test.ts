import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));

import { buildProfile, type ProfileInput } from "@/profile/build";
import { inputFor } from "@/profile/sample";
import { runDetectors } from "./index";
import { SPENDING_DETECTORS } from "./spending";

// Debugger 11-18 (r341, Plaid S6 on a phone): Spending's "Charged twice $86" said "See the
// charges", and the link opened Jane's list at "Alerts: none new", with no Target charge on it.
// A price rise's "See what changed" went to the same place. Both open the charges themselves.

const t = (date: string, amountCents: number, description: string, pfc: string) => ({
  date,
  amountCents,
  description,
  pfc,
  accountId: "x",
});
const fire = (...txs: ProfileInput["transactions"][number][]) => {
  const base = inputFor("freelancer");
  const data = { ...base, transactions: [...base.transactions, ...txs] };
  return runDetectors({ profile: buildProfile(data), data }, SPENDING_DETECTORS);
};

describe("the links to a charge", () => {
  it("open the doubled charge on its days, not the alerts list", () => {
    const s = fire(
      t("2026-09-10", 8_640, "BIG STORE", "GENERAL_MERCHANDISE_SUPERSTORES"),
      t("2026-09-11", 8_640, "BIG STORE", "GENERAL_MERCHANDISE_SUPERSTORES"),
    ).find((x) => x.topic === "duplicate_charge")!;
    expect(s.action.href).toBe("/transactions?q=BIG%20STORE&from=2026-09-10&to=2026-09-11");
  });

  it("open the charge whose price went up", () => {
    const months = ["2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06"];
    const amounts = [999, 999, 999, 999, 999, 1299];
    const s = fire(
      ...months.map((m, i) =>
        t(`${m}-05`, amounts[i], "STREAMCO", "ENTERTAINMENT_OTHER_ENTERTAINMENT"),
      ),
    ).find((x) => x.topic === "price_increase")!;
    expect(s.action.href).toBe("/transactions?q=STREAMCO");
  });
});
