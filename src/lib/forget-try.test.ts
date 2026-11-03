import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { TRY_SESSION_KEYS, forgetThisTry } from "./forget-try";

// A new temporary person must never see the last one's cards or questions in the same tab.

const SOURCES: Record<(typeof TRY_SESSION_KEYS)[number], string> = {
  "jane:dock-cards": "src/components/side-chat/card-dock.tsx",
  "jane:dock-gone": "src/lib/dock-gone.ts",
  "jane.askedFromTree": "src/lib/ask-jane.ts",
};

describe("forgetThisTry", () => {
  it("clears every key the tab keeps about a person", () => {
    const removeItem = vi.fn();
    forgetThisTry({ removeItem });
    expect(removeItem.mock.calls.map(([key]) => key).sort()).toEqual([...TRY_SESSION_KEYS].sort());
  });

  it("stays in step with the code that writes them", () => {
    for (const key of TRY_SESSION_KEYS) expect(readFileSync(SOURCES[key], "utf8")).toContain(key);
  });

  // Any new sessionStorage key about a person belongs in the list: this fails when one appears.
  it("knows every file that keeps something in sessionStorage", () => {
    const writers = [
      "src/components/side-chat/card-dock.tsx",
      "src/lib/dock-gone.ts",
      "src/lib/ask-jane.ts",
      // Only a random id for the visit, and off for trial people.
      "src/lib/activity/recorder.ts",
    ];
    for (const file of writers) expect(readFileSync(file, "utf8")).toContain("sessionStorage");
  });

  it("doesn't mind storage being blocked", () => {
    const throwing = {
      removeItem: () => {
        throw new Error("blocked");
      },
    };
    expect(() => forgetThisTry(throwing)).not.toThrow();
  });
});
