import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT ${url}`);
  }),
}));
vi.mock("@/lib/session", () => ({ requireUser: vi.fn(async () => ({ id: "u1" })) }));
vi.mock("@/lib/family-loans", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/family-loans")>()),
  confirmFamilyLoan: vi.fn(),
  dismissFamilyLoan: vi.fn(),
  settleFamilyLoan: vi.fn(),
  addCosignedLoan: vi.fn(),
}));

import {
  FamilyLoanError,
  addCosignedLoan,
  confirmFamilyLoan,
  dismissFamilyLoan,
  settleFamilyLoan,
} from "@/lib/family-loans";
import {
  addCosignedAction,
  confirmLoanAction,
  dismissLoanAction,
  settleLoanAction,
} from "./actions";

const form = (fields: Record<string, string>) => {
  const data = new FormData();
  for (const [k, v] of Object.entries(fields)) data.set(k, v);
  return data;
};

describe("answering about a transfer", () => {
  it("confirms or dismisses it for the signed-in person only on the tap", async () => {
    vi.mocked(confirmFamilyLoan).mockResolvedValueOnce({} as never);
    await expect(confirmLoanAction(form({ candidateId: "tx:t1" }))).rejects.toThrow(
      "REDIRECT /loans/family?confirmed=1",
    );
    expect(confirmFamilyLoan).toHaveBeenCalledWith("u1", "tx:t1");
    vi.mocked(dismissFamilyLoan).mockResolvedValueOnce();
    await expect(dismissLoanAction(form({ candidateId: "tx:t1" }))).rejects.toThrow(
      "REDIRECT /loans/family?dismissed=1",
    );
    expect(dismissFamilyLoan).toHaveBeenCalledWith("u1", "tx:t1");
  });
  it("shows why when it can't", async () => {
    vi.mocked(confirmFamilyLoan).mockRejectedValueOnce(new FamilyLoanError("Not waiting."));
    await expect(confirmLoanAction(form({ candidateId: "x" }))).rejects.toThrow(
      "REDIRECT /loans/family?error=Not+waiting.",
    );
  });
});

describe("settling and co-signing", () => {
  it("settles a loan and adds a co-signed one", async () => {
    vi.mocked(settleFamilyLoan).mockResolvedValueOnce();
    await expect(settleLoanAction(form({ loanId: "l1" }))).rejects.toThrow(
      "REDIRECT /loans/family?settled=1",
    );
    expect(settleFamilyLoan).toHaveBeenCalledWith("u1", "l1");
    vi.mocked(addCosignedLoan).mockResolvedValueOnce();
    await expect(
      addCosignedAction(form({ debtKey: "account:a1", counterparty: "Sam" })),
    ).rejects.toThrow("REDIRECT /loans/family?cosigned=1");
    expect(addCosignedLoan).toHaveBeenCalledWith("u1", {
      debtKey: "account:a1",
      counterparty: "Sam",
    });
  });
});
