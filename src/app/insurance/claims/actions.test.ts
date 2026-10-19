import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT ${url}`);
  }),
}));
vi.mock("@/lib/session", () => ({ requireUser: vi.fn(async () => ({ id: "u1" })) }));
vi.mock("@/lib/insurance/claims", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/insurance/claims")>()),
  startClaim: vi.fn(async () => ({ id: "c1" })),
  markStepDone: vi.fn(),
  saveClaimNumber: vi.fn(),
  closeClaim: vi.fn(),
}));

import {
  ClaimError,
  closeClaim,
  markStepDone,
  saveClaimNumber,
  startClaim,
} from "@/lib/insurance/claims";
import { claimNumber, finishClaim, newClaim, stepDone } from "./actions";

// The claims page's actions (spec step 107).

const form = (fields: Record<string, string>) => {
  const data = new FormData();
  for (const [k, v] of Object.entries(fields)) data.set(k, v);
  return data;
};

describe("claims page actions", () => {
  beforeEach(() => vi.clearAllMocks());

  it("starts a tracker on a policy or by kind, and goes to it", async () => {
    await expect(
      newClaim(null, form({ policy: "p1", event: "accident", happenedOn: "2026-10-19" })),
    ).rejects.toThrow("REDIRECT /insurance/claims#claim-c1");
    expect(startClaim).toHaveBeenCalledWith("u1", {
      policyId: "p1",
      kind: "",
      event: "accident",
      happenedOn: "2026-10-19",
    });
    await expect(
      newClaim(null, form({ policy: "kind:pet", event: "vet", happenedOn: "" })),
    ).rejects.toThrow("REDIRECT");
    expect(startClaim).toHaveBeenLastCalledWith("u1", {
      policyId: null,
      kind: "pet",
      event: "vet",
      happenedOn: "",
    });
  });

  it("shows a problem starting one", async () => {
    vi.mocked(startClaim).mockRejectedValueOnce(new ClaimError("Pick what happened."));
    expect(await newClaim(null, form({ policy: "p1", event: "x" }))).toEqual({
      message: "Pick what happened.",
    });
  });

  it("marks a step, saves the claim number and closes, for the signed-in person", async () => {
    await expect(stepDone(form({ claimId: "c1", step: "file" }))).rejects.toThrow(
      "REDIRECT /insurance/claims#claim-c1",
    );
    expect(markStepDone).toHaveBeenCalledWith("u1", "c1", "file");
    await expect(claimNumber(form({ claimId: "c1", claimNumber: "CLM-1" }))).rejects.toThrow(
      "REDIRECT",
    );
    expect(saveClaimNumber).toHaveBeenCalledWith("u1", "c1", "CLM-1");
    vi.mocked(closeClaim).mockRejectedValueOnce(new ClaimError("That claim isn't open anymore."));
    await expect(finishClaim(form({ claimId: "c1" }))).rejects.toThrow(
      "REDIRECT /insurance/claims#claim-c1",
    );
  });
});
