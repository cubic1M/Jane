import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT ${url}`);
  }),
}));
vi.mock("@/lib/session", () => ({ requireUser: vi.fn(async () => ({ id: "u1" })) }));
vi.mock("@/lib/refinance", () => ({ checkRates: vi.fn() }));
vi.mock("@/lib/loan-applications", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/loan-applications")>()),
  prepareApplication: vi.fn(),
}));

import { checkRates } from "@/lib/refinance";
import { LoanApplicationError, prepareApplication } from "@/lib/loan-applications";
import { applyAction, checkNow } from "./actions";

describe("check rates now", () => {
  it("checks for the signed-in person and says so", async () => {
    vi.mocked(checkRates).mockResolvedValueOnce([]);
    await expect(checkNow()).rejects.toThrow("REDIRECT /loans/refinance?checked=1");
    expect(checkRates).toHaveBeenCalledWith("u1");
  });

  it("goes back quietly when there's no lending partner", async () => {
    vi.mocked(checkRates).mockResolvedValueOnce(null);
    await expect(checkNow()).rejects.toThrow("REDIRECT /loans/refinance");
  });
});

describe("apply with a lender", () => {
  const form = () => {
    const data = new FormData();
    data.set("debtKey", "account:car");
    data.set("lender", "Harbor Auto Refi");
    return data;
  };
  it("prepares the application, back to the offers while its page is hidden", async () => {
    vi.mocked(prepareApplication).mockResolvedValueOnce({ id: "a1" } as never);
    // /loans/apply/[id] is hidden in the read-only beta (src/config/hidden-pages.ts).
    await expect(applyAction(form())).rejects.toThrow("REDIRECT /loans/refinance");
    expect(prepareApplication).toHaveBeenCalledWith("u1", {
      debtKey: "account:car",
      lender: "Harbor Auto Refi",
    });
  });
  it("shows why when it can't", async () => {
    vi.mocked(prepareApplication).mockRejectedValueOnce(new LoanApplicationError("No offer now."));
    await expect(applyAction(form())).rejects.toThrow(
      "REDIRECT /loans/refinance?error=No+offer+now.",
    );
  });
});
