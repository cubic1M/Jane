import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT ${url}`);
  }),
}));
vi.mock("@/lib/session", () => ({ requireUser: vi.fn(async () => ({ id: "u1" })) }));
vi.mock("@/lib/family-credit", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/family-credit")>()),
  addFamilyCredit: vi.fn(),
  setMissed: vi.fn(),
  removeFamilyCredit: vi.fn(),
}));

import {
  FamilyCreditError,
  addFamilyCredit,
  removeFamilyCredit,
  setMissed,
} from "@/lib/family-credit";
import { addAction, missedAction, removeAction } from "./actions";

const form = (fields: Record<string, string>) => {
  const data = new FormData();
  for (const [k, v] of Object.entries(fields)) data.set(k, v);
  return data;
};

describe("credit given through someone close", () => {
  it("is saved for the signed-in person, blank amounts meaning not given", async () => {
    await expect(
      addAction(form({ kind: "cosigned", person: "Jess", balance: "$12,000", payment: "300" })),
    ).rejects.toThrow("REDIRECT /loans/helping?added=1");
    expect(addFamilyCredit).toHaveBeenCalledWith("u1", {
      kind: "cosigned",
      person: "Jess",
      debtKey: null,
      balanceCents: 1_200_000,
      monthlyPaymentCents: 30_000,
    });
    await expect(addAction(form({ kind: "first_card", person: "Sam" }))).rejects.toThrow("added=1");
    expect(addFamilyCredit).toHaveBeenLastCalledWith("u1", {
      kind: "first_card",
      person: "Sam",
      debtKey: null,
      balanceCents: null,
      monthlyPaymentCents: null,
    });
  });

  it("shows why when an amount isn't one or Jane refuses it", async () => {
    await expect(
      addAction(form({ kind: "cosigned", person: "J", balance: "lots" })),
    ).rejects.toThrow("REDIRECT /loans/helping?error=What%27s+owed+should+be+a+dollar+amount.");
    vi.mocked(addFamilyCredit).mockRejectedValueOnce(new FamilyCreditError("Who is it for?"));
    await expect(addAction(form({ kind: "cosigned", person: "" }))).rejects.toThrow(
      "error=Who+is+it+for%3F",
    );
  });

  it("marks a missed payment and a catch-up, and removes an entry", async () => {
    await expect(missedAction(form({ id: "f1", missed: "yes" }))).rejects.toThrow("updated=1");
    expect(setMissed).toHaveBeenLastCalledWith("u1", "f1", true);
    await expect(missedAction(form({ id: "f1", missed: "no" }))).rejects.toThrow("updated=1");
    expect(setMissed).toHaveBeenLastCalledWith("u1", "f1", false);
    await expect(removeAction(form({ id: "f1" }))).rejects.toThrow("removed=1");
    expect(removeFamilyCredit).toHaveBeenCalledWith("u1", "f1");
  });
});
