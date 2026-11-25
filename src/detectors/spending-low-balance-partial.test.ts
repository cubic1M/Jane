import { describe, expect, it } from "vitest";
import { buildProfile } from "@/profile/build";
import { inputFor } from "@/profile/sample";
import { runDetectors } from "./index";

// CodeRabbit sweep 1b: "your cash is below a month of bills" was worked out from the accounts
// whose balance is on file, while another account's balance was unknown.
const topics = (data: ReturnType<typeof inputFor>) =>
  runDetectors({ profile: buildProfile(data), data }).map((s) => s.topic);

describe("the low-balance card with a balance not on file", () => {
  it("shows for the person whose balances are all on file", () => {
    expect(topics(inputFor("debt"))).toContain("low_balance");
  });
  it("is withheld when another bank account's balance is unknown", () => {
    const d = inputFor("debt");
    const checking = d.accounts.find((a) => a.type === "depository")!;
    const unknown = {
      ...d,
      accounts: [
        ...d.accounts,
        { ...checking, id: "x-unknown", balanceCents: 0, balanceKnown: false },
      ],
    };
    expect(topics(unknown)).not.toContain("low_balance");
  });
});
