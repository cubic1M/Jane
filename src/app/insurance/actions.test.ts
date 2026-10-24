import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT ${url}`);
  }),
}));
vi.mock("@/lib/session", () => ({ requireUser: vi.fn(async () => ({ id: "u1" })) }));
vi.mock("@/lib/insurance/policies", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/insurance/policies")>()),
  addPolicy: vi.fn(),
  updatePolicy: vi.fn(),
  removePolicy: vi.fn(),
}));
vi.mock("@/lib/insurance/negotiate", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/insurance/negotiate")>()),
  negotiationsDue: vi.fn(async () => []),
}));
vi.mock("@/lib/insurance/household", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/insurance/household")>()),
  saveHousehold: vi.fn(),
  dismissGap: vi.fn(),
}));

import { revalidatePath } from "next/cache";
import { HouseholdFactsError, dismissGap, saveHousehold } from "@/lib/insurance/household";
import { negotiationsDue } from "@/lib/insurance/negotiate";
import { PolicyError, addPolicy, removePolicy, updatePolicy } from "@/lib/insurance/policies";
import { deletePolicy, notNeeded, saveHouseholdFacts, savePolicy } from "./actions";

// The insurance page's actions (spec step 102).

const form = (fields: Record<string, string>) => {
  const data = new FormData();
  for (const [k, v] of Object.entries(fields)) data.set(k, v);
  return data;
};
const fields = {
  kind: "renters",
  carrier: "Lemonade",
  premium: "12",
  premiumFrequency: "monthly",
  deductible: "500",
  renewalDate: "2027-03-01",
  termMonths: "12",
  covers: "",
  "coverage.personalProperty": "30000",
  "coverage.liability": "100000",
};
const input = {
  kind: "renters",
  carrier: "Lemonade",
  premium: "12",
  premiumFrequency: "monthly",
  deductible: "500",
  renewalDate: "2027-03-01",
  termMonths: "12",
  covers: "",
  coverage: { personalProperty: "30000", liability: "100000" },
};

describe("insurance page actions", () => {
  beforeEach(() => vi.mocked(revalidatePath).mockClear());

  it("adds a policy with its kind's cover fields and goes back with a confirmation", async () => {
    await expect(savePolicy(null, form(fields))).rejects.toThrow("REDIRECT /insurance?saved=added");
    expect(addPolicy).toHaveBeenCalledWith("u1", input);
    expect(revalidatePath).toHaveBeenCalledWith("/chat");
  });

  it("updates when there's an id", async () => {
    await expect(savePolicy(null, form({ ...fields, policyId: "p1" }))).rejects.toThrow(
      "REDIRECT /insurance?saved=updated",
    );
    expect(updatePolicy).toHaveBeenCalledWith("u1", "p1", input);
    // A rise on the policy just confirmed is looked for at once, not the next night.
    expect(negotiationsDue).toHaveBeenCalledWith("u1");
  });

  it("shows a problem and keeps what was typed", async () => {
    vi.mocked(addPolicy).mockRejectedValueOnce(new PolicyError("Pick how often you pay."));
    expect(await savePolicy(null, form(fields))).toEqual({
      message: "Pick how often you pay.",
      input,
    });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("removes a policy, and goes back quietly when it isn't theirs", async () => {
    await expect(deletePolicy(form({ policyId: "p1" }))).rejects.toThrow(
      "REDIRECT /insurance?saved=removed",
    );
    expect(removePolicy).toHaveBeenCalledWith("u1", "p1");
    vi.mocked(removePolicy).mockRejectedValueOnce(new PolicyError("Not yours."));
    await expect(deletePolicy(form({ policyId: "p2" }))).rejects.toThrow("REDIRECT /insurance");
  });

  it("saves the household facts, or says what's wrong", async () => {
    const household = { housing: "rent", vehicles: "1", dependants: "", pets: "2" };
    await expect(saveHouseholdFacts(null, form(household))).rejects.toThrow(
      "REDIRECT /insurance?saved=household",
    );
    expect(saveHousehold).toHaveBeenCalledWith("u1", household);
    vi.mocked(saveHousehold).mockRejectedValueOnce(new HouseholdFactsError("Enter how many."));
    expect(await saveHouseholdFacts(null, form({ ...household, pets: "lots" }))).toEqual({
      message: "Enter how many.",
      input: { ...household, pets: "lots" },
    });
  });

  it("dismisses only a known gap", async () => {
    await expect(notNeeded(form({ gap: "life" }))).rejects.toThrow("REDIRECT /insurance?saved=gap");
    expect(dismissGap).toHaveBeenCalledWith("u1", "life");
    vi.mocked(dismissGap).mockClear();
    await expect(notNeeded(form({ gap: "boats" }))).rejects.toThrow("REDIRECT");
    expect(dismissGap).not.toHaveBeenCalled();
  });
});
