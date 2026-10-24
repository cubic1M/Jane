import { describe, expect, it } from "vitest";
import { canScroll, takesScroll, type Scroller } from "./contain-scroll";

const box = (scrollTop: number, scrollHeight = 1000, clientHeight = 400): Scroller => ({
  scrollTop,
  scrollHeight,
  clientHeight,
  overflowY: "auto",
});

describe("the chat keeps its scroll to itself", () => {
  it("lets a chat in the middle move both ways", () => {
    expect(canScroll(box(300), 50)).toBe(true);
    expect(canScroll(box(300), -50)).toBe(true);
  });

  it("stops at the end going down and at the top going up", () => {
    expect(canScroll(box(600), 50)).toBe(false);
    expect(canScroll(box(600), -50)).toBe(true);
    expect(canScroll(box(0), -50)).toBe(false);
    expect(canScroll(box(0), 50)).toBe(true);
  });

  it("never hands on a scroll from a chat too short to scroll", () => {
    expect(canScroll(box(0, 400, 400), 50)).toBe(false);
    expect(takesScroll([box(0, 400, 400)], 50)).toBe(false);
  });

  it("lets a box inside the chat take it while it can, but not a box that doesn't scroll", () => {
    const inner = box(0, 600, 200);
    const page = box(600);
    expect(takesScroll([inner, page], 50)).toBe(true);
    expect(takesScroll([{ ...inner, overflowY: "visible" }, page], 50)).toBe(false);
  });
});
