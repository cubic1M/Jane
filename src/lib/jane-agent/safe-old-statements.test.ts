import { describe, expect, it } from "vitest";
import { safeReply } from "./replies";

// Debugger 11-16 (a Capital One 360 statement ending Sep 29, uploaded Nov 16): "what's safe to
// spend?" got "Jane needs your checking balance for this: link the account, or add its balance on
// the import page", though the file carried a balance and the idle cash card used it. Safe to
// spend is left out because that balance is seven weeks old; the answer says that, and where to
// put newer statements.

describe("safe to spend from old statements", () => {
  it("says the statements are old, never asks for a balance Jane has", () => {
    const answer = safeReply(null, "2026-11-16", { statementsEnd: "2026-09-29" });
    expect(answer.body).toBe(
      "Your statements end Sep 29, 2026, so I can't say what's safe to spend today. Upload newer statements and I'll work it out.",
    );
    expect(answer.body).not.toMatch(/checking balance/);
    expect(answer.actions).toEqual([
      expect.objectContaining({ label: "Upload newer statements", href: "/import" }),
    ]);
  });

  it("still asks for a balance when there's none", () => {
    expect(safeReply(null, "2026-11-16").body).toMatch(/^Jane needs your checking balance/);
  });
});
