import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT ${url}`);
  }),
}));
vi.mock("@/lib/session", () => ({ requireUser: vi.fn(async () => ({ id: "u1" })) }));
vi.mock("@/lib/borrowing-power", () => ({ checkBorrowing: vi.fn() }));

import { checkBorrowing } from "@/lib/borrowing-power";
import { checkAgainAction } from "./actions";

// Spec step 250: "Check again" on /loans/borrow runs the soft checks for the signed-in person.
describe("check again", () => {
  it("soft-checks for the signed-in person and says so", async () => {
    vi.mocked(checkBorrowing).mockResolvedValueOnce({} as never);
    await expect(checkAgainAction()).rejects.toThrow("REDIRECT /loans/borrow?checked=1");
    expect(checkBorrowing).toHaveBeenLastCalledWith("u1");
  });

  it("goes back to the page when there's no lending partner", async () => {
    vi.mocked(checkBorrowing).mockResolvedValueOnce(null);
    await expect(checkAgainAction()).rejects.toThrow("REDIRECT /loans/borrow");
  });
});
