import { describe, expect, it } from "vitest";
import { BOX_MIN_PX, boxHeight } from "./box-height";

// Founder (11-11): the message box keeps its width and grows with the text, up to about 40% of
// the screen showing, then scrolls inside.

describe("the message box's height", () => {
  it("is one line when there is one line, or nothing", () => {
    expect(boxHeight(0, 800)).toEqual({ height: BOX_MIN_PX, scrolls: false });
    expect(boxHeight(44, 800)).toEqual({ height: 44, scrolls: false });
  });

  it("grows with the text", () => {
    expect(boxHeight(140, 800)).toEqual({ height: 140, scrolls: false });
  });

  it("stops at 40% of the screen showing and scrolls past it, less with a keyboard open", () => {
    expect(boxHeight(900, 800)).toEqual({ height: 320, scrolls: true });
    // A phone with its keyboard up: about 400px showing.
    expect(boxHeight(300, 400)).toEqual({ height: 160, scrolls: true });
  });
});
