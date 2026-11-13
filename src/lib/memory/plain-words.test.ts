import { describe, expect, it, vi } from "vitest";

const { recordFacts } = vi.hoisted(() => ({ recordFacts: vi.fn(async () => []) }));
vi.mock("./facts", () => ({ recordFacts }));
vi.mock("@/lib/db", () => ({ db: {} }));

import { factWords } from "@/profile/facts";
import { learnFromAnswer } from "./learn";

// Debugger 11-13, "What Jane knows about you" for a new student: "Where you live: own", "How you
// eat: cooks", "You tend to act on pmi removal suggestions". Stored codes and topic keys, not
// how anyone says them.

describe("what Jane knows, in plain words", () => {
  it("says a choice as a person would, not its stored code", () => {
    expect(factWords("housing", "own")).toBe("you own your home");
    expect(factWords("housing", "rent")).toBe("you rent");
    expect(factWords("eating_style", "cooks")).toBe("mostly at home");
    expect(factWords("eating_style", "eats_out")).toBe("mostly out");
    expect(factWords("filing_status", "married_joint")).toBe("married, filing jointly");
    expect(factWords("business_structure", "s_corp")).toBe("S corporation");
    expect(factWords("age_band", "73_plus")).toBe("73 or older");
    // A code with no words of its own still loses its underscores.
    expect(factWords("housing", "some_new_code")).toBe("some new code");
  });

  it("names a suggestion's kind as the page does, acronyms in capitals", async () => {
    await learnFromAnswer("u1", { topic: "pmi_removal", acted: true, ref: "suggestion:x" });
    await learnFromAnswer("u1", { topic: "employer_match", acted: false, ref: "suggestion:y" });
    const labels = recordFacts.mock.calls.map(
      (c) => (c as unknown as [string, { label: string }[]])[1][0]!.label,
    );
    expect(labels).toEqual([
      "You tend to act on PMI removal suggestions",
      "You tend to pass on employer match suggestions",
    ]);
  });
});
