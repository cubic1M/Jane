import { describe, expect, it } from "vitest";
import { removedWording, staleWording, stringsIn } from "../../scripts/e2e-wording-core.mjs";

// Three pushes went red on wording an end-to-end spec still expected (debugger 11-02); these are
// those three, from the diffs that caused them.
const spec = (text: string) => [{ file: "e2e/x.spec.ts", text }];

describe("wording removed from src/ that a spec still expects", () => {
  it("finds a unit test's old words in a spec with different words around them", () => {
    const diff = [
      '-    ).toEqual({ ok: true, message: "Using your W-2 from ACME CORP PAYROLL as it is." });',
      '+    ).toEqual({ ok: true, message: "Using your W-2 from ACME CORP as it is." });',
    ].join("\n");
    const hits = staleWording(
      diff,
      spec('  await expect(x).toContainText("W-2 from ACME CORP PAYROLL");'),
    );
    expect(hits.map((h: { wording: string }) => h.wording)).toContain("from acme corp payroll");
  });

  it("finds them in a spec's regular expression, escapes and all", () => {
    const diff = [
      '-      "Are you driving for Uber? I saw $412.00 come in from Uber Driver on Oct 7. A policy",',
      '+      "Are you driving for Uber? I saw $412.00 come in from Uber on Oct 7. A policy",',
    ].join("\n");
    const hits = staleWording(
      diff,
      spec("  await expect(uber.getByText(/I saw \\$412\\.00 come in from Uber Driver/).first());"),
    );
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]).toMatchObject({ file: "e2e/x.spec.ts", line: 1 });
  });

  it("says nothing when the spec has the new words, or the words only moved", () => {
    const moved = [
      '-  const a = "one two three four five";',
      '+  const b = "one two three four five";',
    ];
    expect(removedWording(moved.join("\n"))).toEqual([]);
    const diff = [
      '-  "Review your Netflix subscription at $15.49"',
      '+  "Review your Netflix plan"',
    ];
    expect(staleWording(diff.join("\n"), spec('  await see("Review your Netflix plan");'))).toEqual(
      [],
    );
  });

  it("reads strings, templates and regular expressions", () => {
    expect(stringsIn('x("a b") + `c ${d} e`')).toEqual(["a b", "c ", " e"]);
    expect(stringsIn("x(/come in from Uber Driver/i)")).toEqual(["come in from Uber Driver"]);
  });
});
