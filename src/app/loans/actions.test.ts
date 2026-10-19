import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT ${url}`);
  }),
}));
vi.mock("@/lib/session", () => ({ requireUser: vi.fn(async () => ({ id: "u1" })) }));
vi.mock("@/lib/debts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/debts")>()),
  saveDebtTerms: vi.fn(),
  clearDebtTerms: vi.fn(),
}));

import { revalidatePath } from "next/cache";
import { DebtTermsError, clearDebtTerms, saveDebtTerms } from "@/lib/debts";
import { clearTerms, saveTerms } from "./actions";

const form = (fields: Record<string, string>) => {
  const data = new FormData();
  for (const [k, v] of Object.entries(fields)) data.set(k, v);
  return data;
};
const fields = {
  debtKey: "account:store",
  apr: "28.99",
  minimum: "25",
  balance: "",
  payoffDate: "",
};

describe("debt terms actions", () => {
  beforeEach(() => vi.mocked(revalidatePath).mockClear());

  it("saves for the signed-in person and goes back with a confirmation", async () => {
    await expect(saveTerms(form(fields))).rejects.toThrow("REDIRECT /loans?saved=terms");
    expect(saveDebtTerms).toHaveBeenCalledWith("u1", fields);
    expect(revalidatePath).toHaveBeenCalledWith("/debt");
  });

  it("opens the form again with the problem", async () => {
    vi.mocked(saveDebtTerms).mockRejectedValueOnce(new DebtTermsError("Enter the rate."));
    await expect(saveTerms(form(fields))).rejects.toThrow(
      "REDIRECT /loans?terms=account%3Astore&error=Enter+the+rate.#terms",
    );
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("clears what was typed", async () => {
    await expect(clearTerms(form({ debtKey: "bnpl:affirm:8950" }))).rejects.toThrow(
      "REDIRECT /loans?saved=cleared",
    );
    expect(clearDebtTerms).toHaveBeenCalledWith("u1", "bnpl:affirm:8950");
  });
});
