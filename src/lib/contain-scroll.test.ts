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

// Founder: "for the suggestion cards, you can't scroll down with mouse wheel". The dock is one
// scroller for a card and its details; a wheel over any part of the card moves it, and what it
// can't take further stays in it (keepWheel), never moving the page or the chat behind.
describe("the card dock keeps its wheel", () => {
  const card = (overflowY = "visible"): Scroller => ({
    scrollTop: 0,
    scrollHeight: 60,
    clientHeight: 60,
    overflowY,
  });

  it("takes a wheel over the card's headline while the dock can move", () => {
    expect(takesScroll([card(), card(), box(0, 900, 400)], 100)).toBe(true);
  });

  it("keeps it (nothing takes it) at the dock's end, or in a dock too short to scroll", () => {
    expect(takesScroll([card(), box(500, 900, 400)], 100)).toBe(false);
    expect(takesScroll([card(), box(0, 300, 300)], 100)).toBe(false);
  });
});
