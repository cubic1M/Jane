import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT ${url}`);
  }),
}));
vi.mock("@/lib/session", () => ({ requireUser: vi.fn(async () => ({ id: "u1" })) }));
vi.mock("@/lib/insurance/quotes", () => ({ requestQuotes: vi.fn() }));

import { requestQuotes } from "@/lib/insurance/quotes";
import { getQuotes } from "./actions";

// "Get quotes" on the quotes page (spec step 103).

const form = (policyId: string) => {
  const data = new FormData();
  data.set("policyId", policyId);
  return data;
};

describe("getting quotes from the quotes page", () => {
  it("asks for the signed-in person's policy and shows the quotes", async () => {
    vi.mocked(requestQuotes).mockResolvedValueOnce({
      kind: "unavailable",
      reason: "no_partner",
    });
    await expect(getQuotes(form("p1"))).rejects.toThrow("REDIRECT /insurance/quotes?policy=p1");
    expect(requestQuotes).toHaveBeenCalledWith("u1", "p1");
  });

  it("goes back to insurance when the policy isn't theirs", async () => {
    vi.mocked(requestQuotes).mockResolvedValueOnce({ kind: "unavailable", reason: "not_found" });
    await expect(getQuotes(form("other"))).rejects.toThrow("REDIRECT /insurance");
  });
});
