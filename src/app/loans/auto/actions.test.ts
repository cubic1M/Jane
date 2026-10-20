import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT ${url}`);
  }),
}));
vi.mock("@/lib/session", () => ({ requireUser: vi.fn(async () => ({ id: "u1" })) }));
vi.mock("@/lib/car-loan", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/car-loan")>()),
  confirmAddon: vi.fn(),
  dismissAddon: vi.fn(),
  addTypedAddon: vi.fn(),
  requestCancellation: vi.fn(),
}));

import {
  CarLoanError,
  addTypedAddon,
  confirmAddon,
  dismissAddon,
  requestCancellation,
} from "@/lib/car-loan";
import {
  addAddonAction,
  cancelAddonAction,
  confirmAddonAction,
  dismissAddonAction,
} from "./actions";

const form = (fields: Record<string, string>) => {
  const data = new FormData();
  for (const [k, v] of Object.entries(fields)) data.set(k, v);
  return data;
};

describe("car loan add-ons", () => {
  it("are confirmed or dismissed for the signed-in person", async () => {
    vi.mocked(confirmAddon).mockResolvedValueOnce({} as never);
    await expect(confirmAddonAction(form({ key: "tx:1", termMonths: "60" }))).rejects.toThrow(
      "REDIRECT /loans/auto?confirmed=1",
    );
    expect(confirmAddon).toHaveBeenCalledWith("u1", "tx:1", { termMonths: 60 });
    vi.mocked(dismissAddon).mockResolvedValueOnce();
    await expect(dismissAddonAction(form({ key: "tx:1" }))).rejects.toThrow(
      "REDIRECT /loans/auto?dismissed=1",
    );
  });
  it("can be added by hand, with the price read as dollars", async () => {
    vi.mocked(addTypedAddon).mockResolvedValueOnce();
    await expect(
      addAddonAction(
        form({
          kind: "gap",
          name: "Big Dealer",
          paid: "$695",
          termMonths: "72",
          startedOn: "2025-10-01",
        }),
      ),
    ).rejects.toThrow("REDIRECT /loans/auto?added=1");
    expect(addTypedAddon).toHaveBeenCalledWith("u1", {
      kind: "gap",
      name: "Big Dealer",
      paidCents: 69_500,
      termMonths: 72,
      startedOn: "2025-10-01",
    });
    await expect(addAddonAction(form({ paid: "lots" }))).rejects.toThrow(
      "REDIRECT /loans/auto?error=The+price+should+be+a+dollar+amount.",
    );
  });
  it("have the cancellation sent by the person or the team, nobody else", async () => {
    vi.mocked(requestCancellation).mockResolvedValue();
    await expect(cancelAddonAction(form({ id: "a1", by: "team" }))).rejects.toThrow(
      "REDIRECT /loans/auto?requested=1",
    );
    expect(requestCancellation).toHaveBeenCalledWith("u1", "a1", "team");
    await expect(cancelAddonAction(form({ id: "a1", by: "jane" }))).rejects.toThrow(
      "REDIRECT /loans/auto",
    );
    expect(requestCancellation).toHaveBeenCalledTimes(1);
  });
  it("show why when it can't", async () => {
    vi.mocked(confirmAddon).mockRejectedValueOnce(new CarLoanError("Gone."));
    await expect(confirmAddonAction(form({ key: "x" }))).rejects.toThrow(
      "REDIRECT /loans/auto?error=Gone.",
    );
  });
});
