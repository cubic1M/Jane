import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));

import { buildProfile, type ProfileInput } from "@/profile/build";
import { inputFor } from "@/profile/sample";
import { HEALTH_YEAR_DETECTORS } from "./health-year";

// CodeRabbit sweep 1c, det-01 finding 16.
const family = inputFor("family");
const account = family.accounts.find((a) => a.type === "depository")!.id;
const fire = (data: ProfileInput, topic: string) =>
  HEALTH_YEAR_DETECTORS.find((d) => d.topic === topic)!.detect({
    profile: buildProfile(data),
    data,
  });
const medical = (date: string, cents: number, description: string) => ({
  id: `m-${date}-${cents}`,
  date,
  amountCents: cents,
  description,
  pfc: "MEDICAL_PRIMARY_CARE",
  accountId: account,
});
const only = (
  rows: ReturnType<typeof medical>[],
  extra: Partial<ProfileInput> = {},
): ProfileInput => ({
  ...family,
  ...extra,
  transactions: [
    ...family.transactions.filter((t) => !(t.pfc ?? "").startsWith("MEDICAL_")),
    ...rows,
  ],
});
const thisYear = family.today.slice(0, 4);

describe("a medical bill from last year", () => {
  it("is not priced by the plan now on file", () => {
    const old = only([medical(`${Number(thisYear) - 1}-05-10`, 210_000, "BAYVIEW IMAGING CENTER")]);
    expect(fire(old, "medical_bill_dispute")).toBeNull();
    const now = only([medical(`${thisYear}-05-10`, 210_000, "BAYVIEW IMAGING CENTER")]);
    expect(fire(now, "medical_bill_dispute")).not.toBeNull();
  });
});
