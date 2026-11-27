import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { LastRun, type Search } from "./last-run";

// The keys page after a press: "everything" only when nothing is left off the current key.

const said = (search: Search, behind = 0, stuck = 0) =>
  renderToStaticMarkup(<LastRun search={search} behind={behind} stuck={stuck} />)
    .replace(/<!-- -->/g, "")
    .replace(/<[^>]+>/g, "")
    .replaceAll("&#x27;", "'");

const finished = { rotated: "2", failed: "0", done: "1" };

describe("what the keys page says about the last press", () => {
  it("says it went through everything when nothing is left", () => {
    expect(said(finished)).toContain("It went through everything.");
  });

  it("says how many are left, and to press again, when a finished run left some", () => {
    const text = said(finished, 3);
    expect(text).not.toContain("went through everything");
    expect(text).toContain("3 values are still on an older key: press it again");
    expect(said(finished, 1)).toContain("1 value is still on an older key");
  });

  it("doesn't ask for another press when all that's left can't be read", () => {
    const text = said(finished, 0, 1);
    expect(text).toContain("everything it can read; 1 value can't be read");
    expect(text).not.toContain("press it again");
  });

  it("says it ran out of time when it did", () => {
    expect(said({ ...finished, done: "0" }, 3)).toContain("It ran out of time: press it again.");
  });

  it("says nothing before a press", () => {
    expect(said({})).toBe("");
  });
});
