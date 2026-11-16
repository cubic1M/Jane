import { describe, expect, it } from "vitest";
import { holdingsReply } from "./replies";
import type { Investments } from "@/lib/investments/holdings";

// Debug 2 (11-16, a Plaid sandbox checking account sending $500 a month to Fidelity, the side
// chat at 1280 light): "how much have I invested?" → "I don't see any investment or retirement
// accounts yet. Link one…" with "Link an account". In the beta a linked brokerage isn't read
// (Plaid Investments is off), so that led nowhere. The answer sends the person to the positions
// upload, which is how investments get in.

const none = { accounts: [] } as unknown as Investments;

describe("investments, with none on file", () => {
  it("points to the positions upload, not to linking", () => {
    const reply = holdingsReply(none, null);
    expect(reply.body).toContain("Upload a positions download from your brokerage");
    expect(reply.actions).toEqual([
      expect.objectContaining({ label: "Upload your investments", href: "/import/investments" }),
    ]);
  });
});
