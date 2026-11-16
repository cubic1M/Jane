import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));

import { buildProfile, type ProfileInput } from "@/profile/build";
import { inputFor } from "@/profile/sample";
import { nice } from "./helpers";
import { runDetectors } from "./index";
import { SPENDING_DETECTORS } from "./spending";

// Debugger 11-15: a student who uploaded a Bank of America statement read "A bill you can lower:
// You pay $1,079.88 a year on Comcast Cable Comm 800-Comcast Pa." Bank of America prints the
// payee's toll-free number spelled in letters, and the state after it; a numeric one was already
// taken off.

const comcast = ["2026-08-20", "2026-09-20", "2026-10-20"].map((date) => ({
  date,
  amountCents: 8_999,
  description: "COMCAST CABLE COMM 800-COMCAST PA",
  pfc: "RENT_AND_UTILITIES_INTERNET_AND_CABLE",
  accountId: "x",
}));

describe("a payee with a toll-free number in letters", () => {
  it("is named without it on the bill line", () => {
    const base = inputFor("preretire");
    const data: ProfileInput = {
      ...base,
      transactions: [
        // Only this bill: the sample person's own internet and phone bills are left out.
        ...base.transactions.filter(
          (t) =>
            !t.pfc?.startsWith("RENT_AND_UTILITIES_TELEPHONE") &&
            t.pfc !== "RENT_AND_UTILITIES_INTERNET_AND_CABLE",
        ),
        ...comcast,
      ],
    };
    const bill = runDetectors({ profile: buildProfile(data), data }, SPENDING_DETECTORS).find(
      (s) => s.topic === "bill_negotiation",
    );
    expect(bill).toBeDefined();
    expect(bill!.short).toContain("Comcast Cable Comm.");
    expect(`${bill!.short} ${bill!.why}`).not.toMatch(/800|Pa\b/);
  });

  it("keeps a street number and a numeric phone number's old handling", () => {
    expect(nice("CAFE 800 BROADWAY")).toBe("Cafe 800 Broadway");
    expect(nice("DISNEY PLUS 888-905-7888 CA")).toBe("Disney Plus");
    expect(nice("1-800-FLOWERS.COM")).toBe("1-800-Flowers");
  });
});
