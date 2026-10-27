import { describe, expect, it } from "vitest";
import { importPercent, readEvents, stepLabel } from "./progress";

describe("the import's progress bar", () => {
  it("names each step plainly, with the number of transactions being sorted", () => {
    expect(stepLabel("reading", null)).toBe("Reading your file");
    expect(stepLabel("sorting", 172)).toBe("Sorting 172 transactions");
    expect(stepLabel("sorting", 1)).toBe("Sorting 1 transaction");
    expect(stepLabel("saving", 172)).toBe("Saving");
    expect(stepLabel("looking", 172)).toBe("Looking for savings");
  });

  it("reaches a step's share when it starts, and creeps toward the next without reaching it", () => {
    expect(importPercent(null, 0)).toBe(0);
    expect(importPercent("reading", 0)).toBe(5);
    expect(importPercent("sorting", 0)).toBe(25);
    expect(importPercent("sorting", 1)).toBe(43);
    expect(importPercent("looking", 0)).toBe(65);
    expect(importPercent("looking", 1)).toBe(97);
    expect(importPercent("looking", 5)).toBe(97);
  });
});

describe("readEvents", () => {
  it("reads whole lines and keeps a half-sent one for later", () => {
    expect(readEvents('{"stage":"reading"}\n{"stage":"sorting","rows":3}\n{"sta')).toEqual({
      events: [{ stage: "reading" }, { stage: "sorting", rows: 3 }],
      rest: '{"sta',
    });
  });

  it("skips a line that isn't JSON", () => {
    expect(readEvents('oops\n{"type":"done","foundCents":0,"next":"/report"}\n')).toEqual({
      events: [{ type: "done", foundCents: 0, next: "/report" }],
      rest: "",
    });
  });
});
