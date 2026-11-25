import { describe, expect, it } from "vitest";
import { classifyText } from "./event-detect";

// CodeRabbit sweep 1c, cfg-01 #2: a headline saying a thing did not happen is not that event.

const type = (t: string) => classifyText(t)[0]?.type ?? null;

describe("classifyText and negated headlines", () => {
  it("does not read a negated Fed decision as one", () => {
    expect(type("Fed will not cut rates, Powell says")).not.toBe("fed_cut");
    expect(type("Fed won't cut rates this year")).not.toBe("fed_cut");
    expect(type("Fed won\u2019t cut rates this year")).not.toBe("fed_cut");
    expect(type("Federal Reserve does not raise rates")).not.toBe("fed_hike");
    expect(type("Fed rules out a rate hike")).not.toBe("fed_hike");
  });

  it("does not read other negated events", () => {
    expect(type("Iran has not launched missiles at Israel")).toBeNull();
  });

  it("still reads the real ones", () => {
    expect(type("Fed cuts rates by half a point")).toBe("fed_cut");
    expect(type("Fed cuts rates, not hikes them")).toBe("fed_cut");
    expect(type("The Federal Reserve raises interest rates again")).toBe("fed_hike");
  });
});
