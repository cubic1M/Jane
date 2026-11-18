import { describe, expect, it } from "vitest";
import { parseIntent } from "../intents";

// Debugger 11-18 (r343 and r347: checking that sends $200 a month to Fidelity, on a phone): "how
// much am i putting into fidelity?" answered "I can't answer that one yet", though "how much do i
// put into fidelity?" says what went in.

const kind = (text: string) => parseIntent(text, "2026-11-18");

describe("what's going into an investment account", () => {
  it("is asked as it goes, too", () => {
    expect(kind("how much am i putting into fidelity?")).toEqual(
      kind("how much do i put into fidelity?"),
    );
    expect(kind("how much am i sending to vanguard each month?")).toMatchObject({
      kind: "investments",
      sent: true,
    });
  });
});
