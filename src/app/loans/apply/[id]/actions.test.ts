import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT ${url}`);
  }),
}));
vi.mock("@/lib/session", () => ({ requireUser: vi.fn(async () => ({ id: "u1" })) }));
vi.mock("@/lib/loan-applications", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/loan-applications")>()),
  submitApplication: vi.fn(),
  acceptLoan: vi.fn(),
  withdrawApplication: vi.fn(),
}));

import {
  LoanApplicationError,
  acceptLoan,
  submitApplication,
  withdrawApplication,
} from "@/lib/loan-applications";
import { acceptAction, submitAction, withdrawAction } from "./actions";

const form = (fields: Record<string, string>) => {
  const data = new FormData();
  for (const [k, v] of Object.entries(fields)) data.set(k, v);
  return data;
};

describe("the application review screen", () => {
  it("submits only with the terms reviewed, for the signed-in person", async () => {
    await expect(submitAction(form({ id: "a1", reviewed: "on" }))).rejects.toThrow(
      "REDIRECT /loans/apply/a1?done=submitted",
    );
    expect(submitApplication).toHaveBeenCalledWith("u1", "a1", { reviewed: true });
    vi.mocked(submitApplication).mockRejectedValueOnce(
      new LoanApplicationError("Review the terms before you apply."),
    );
    await expect(submitAction(form({ id: "a1" }))).rejects.toThrow(
      "REDIRECT /loans/apply/a1?error=Review+the+terms+before+you+apply.",
    );
    expect(submitApplication).toHaveBeenLastCalledWith("u1", "a1", { reviewed: false });
  });

  it("accepts and withdraws", async () => {
    await expect(acceptAction(form({ id: "a1" }))).rejects.toThrow("done=accepted");
    expect(acceptLoan).toHaveBeenCalledWith("u1", "a1");
    await expect(withdrawAction(form({ id: "a1" }))).rejects.toThrow("done=withdrawn");
    expect(withdrawApplication).toHaveBeenCalledWith("u1", "a1");
  });
});
