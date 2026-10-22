import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT ${url}`);
  }),
}));
vi.mock("@/lib/session", () => ({ requireUser: vi.fn(async () => ({ id: "u1" })) }));
vi.mock("@/lib/renting", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/renting")>()),
  setRentReporting: vi.fn(),
  saveDeposit: vi.fn(),
  markDepositReturned: vi.fn(),
}));

import { RentingError, markDepositReturned, saveDeposit, setRentReporting } from "@/lib/renting";
import { depositAction, depositReturnedAction, reportingAction } from "./actions";

const form = (fields: Record<string, string>) => {
  const data = new FormData();
  for (const [k, v] of Object.entries(fields)) data.set(k, v);
  return data;
};

describe("rent reporting", () => {
  it("turns on only from an explicit yes, and off from anything else", async () => {
    await expect(reportingAction(form({ on: "yes" }))).rejects.toThrow(
      "REDIRECT /loans/renting?reporting_on=1",
    );
    expect(setRentReporting).toHaveBeenLastCalledWith("u1", true);
    await expect(reportingAction(form({ on: "no" }))).rejects.toThrow(
      "REDIRECT /loans/renting?reporting_off=1",
    );
    expect(setRentReporting).toHaveBeenLastCalledWith("u1", false);
    await expect(reportingAction(form({}))).rejects.toThrow("reporting_off=1");
    expect(setRentReporting).toHaveBeenLastCalledWith("u1", false);
  });
});

describe("a deposit", () => {
  it("is saved for the signed-in person, a blank move-out day meaning not yet", async () => {
    await expect(
      depositAction(form({ amount: "$1,500", state: "CA", movedOutOn: "" })),
    ).rejects.toThrow("REDIRECT /loans/renting?deposit=1");
    expect(saveDeposit).toHaveBeenCalledWith("u1", {
      amountCents: 150_000,
      state: "CA",
      movedOutOn: null,
    });
  });
  it("shows why when the amount isn't one or the state is refused", async () => {
    await expect(depositAction(form({ amount: "lots", state: "CA" }))).rejects.toThrow(
      "REDIRECT /loans/renting?error=The+deposit+should+be+a+dollar+amount.",
    );
    vi.mocked(saveDeposit).mockRejectedValueOnce(new RentingError("Pick the state."));
    await expect(depositAction(form({ amount: "5", state: "" }))).rejects.toThrow(
      "REDIRECT /loans/renting?error=Pick+the+state.",
    );
  });
  it("is marked returned with the amount that came back", async () => {
    await expect(depositReturnedAction(form({ id: "d1", returned: "1200" }))).rejects.toThrow(
      "REDIRECT /loans/renting?returned=1",
    );
    expect(markDepositReturned).toHaveBeenCalledWith("u1", "d1", 120_000);
    await expect(depositReturnedAction(form({ id: "d1", returned: "x" }))).rejects.toThrow(
      "error=The+amount+returned",
    );
  });
});
