import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT ${url}`);
  }),
}));
vi.mock("@/lib/session", () => ({ requireUser: vi.fn(async () => ({ id: "u1" })) }));
vi.mock("@/lib/refinance", () => ({ checkRates: vi.fn() }));

import { checkRates } from "@/lib/refinance";
import { checkNow } from "./actions";

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
