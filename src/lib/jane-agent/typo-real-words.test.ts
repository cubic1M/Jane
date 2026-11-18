import { describe, expect, it } from "vitest";
import { fixTypos } from "./intents";

// Debugger 11-17 (r333): "how much did I send to Fidelity" was fixed to "how much did I spend to
// Fidelity" and answered with the whole month's spending. A real word one letter from a word Jane
// knows ("send", "sent", "pending") isn't a typo for it.

describe("real words near the vocabulary", () => {
  it("aren't fixed into it", () => {
    expect(fixTypos("how much did i send to fidelity")).toBe("how much did i send to fidelity");
    expect(fixTypos("how much have i sent to fidelity")).toBe("how much have i sent to fidelity");
    expect(fixTypos("what are my pending charges")).toBe("what are my pending charges");
  });

  it("still fixes a real slip", () => {
    expect(fixTypos("how much did i spnd")).toBe("how much did i spend");
  });
});
