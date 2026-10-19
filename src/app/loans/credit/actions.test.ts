import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT ${url}`);
  }),
}));
vi.mock("@/lib/session", () => ({ requireUser: vi.fn(async () => ({ id: "u1" })) }));
vi.mock("@/lib/credit-building", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/credit-building")>()),
  payBeforeStatement: vi.fn(),
  applyForBuilder: vi.fn(),
}));

import { CreditBuildingError, applyForBuilder, payBeforeStatement } from "@/lib/credit-building";
import { openBuilderAction, payStatementAction } from "./actions";

const form = (fields: Record<string, string>) => {
  const data = new FormData();
  for (const [k, v] of Object.entries(fields)) data.set(k, v);
  return data;
};

describe("pay before the statement", () => {
  const pay = () => form({ accountId: "a1", closesOn: "2026-11-01" });
  it("pays for the signed-in person, only on the tap", async () => {
    vi.mocked(payBeforeStatement).mockResolvedValueOnce({} as never);
    await expect(payStatementAction(pay())).rejects.toThrow(
      "REDIRECT /loans/credit?done=paid#build",
    );
    expect(payBeforeStatement).toHaveBeenCalledWith("u1", {
      accountId: "a1",
      closesOn: "2026-11-01",
    });
  });
  it("shows why when it can't", async () => {
    vi.mocked(payBeforeStatement).mockRejectedValueOnce(
      new CreditBuildingError("Already scheduled."),
    );
    await expect(payStatementAction(pay())).rejects.toThrow(
      "REDIRECT /loans/credit?error=Already+scheduled.#build",
    );
  });
});

describe("open a credit builder", () => {
  it("opens it for the signed-in person and says so", async () => {
    vi.mocked(applyForBuilder).mockResolvedValueOnce({} as never);
    await expect(openBuilderAction(form({ productId: "willow-secured" }))).rejects.toThrow(
      "REDIRECT /loans/credit?done=opened#build",
    );
    expect(applyForBuilder).toHaveBeenCalledWith("u1", "willow-secured");
  });
});
