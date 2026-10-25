import { describe, expect, it } from "vitest";
import { placePopup, popupLine, type Box } from "./place-popup";

const viewport = { width: 1280, height: 800 };
const size = { width: 320, height: 260 };
const hits = (a: Box, b: Box) =>
  a.left < b.left + b.width &&
  b.left < a.left + a.width &&
  a.top < b.top + b.height &&
  b.top < a.top + a.height;

describe("placePopup", () => {
  it("goes to the right of the tile when there's room", () => {
    const anchor = { left: 100, top: 400, width: 300, height: 200 };
    expect(placePopup({ anchor, size, viewport })).toEqual({ left: 412, top: 400, side: "right" });
  });

  it("flips to the left when the right is the chat", () => {
    const anchor = { left: 560, top: 400, width: 300, height: 200 };
    const chat = { left: 880, top: 0, width: 400, height: 800 };
    const at = placePopup({ anchor, size, viewport, avoid: [chat] });
    expect(at.side).toBe("left");
    expect(hits({ ...at, ...size }, chat)).toBe(false);
    expect(hits({ ...at, ...size }, anchor)).toBe(false);
  });

  it("on a phone, goes below the tile: never over it, the chart above or off the screen", () => {
    const phone = { width: 375, height: 812 };
    const anchor = { left: 16, top: 420, width: 343, height: 220 };
    const chart = { left: 16, top: 60, width: 343, height: 340 };
    const at = placePopup({
      anchor,
      size: { width: 343, height: 300 },
      viewport: phone,
      avoid: [chart],
    });
    expect(at.side).toBe("below");
    expect(at.top).toBe(652);
    expect(at.left).toBe(16);
  });

  it("goes above when below is the chat's sheet", () => {
    const phone = { width: 375, height: 812 };
    const anchor = { left: 16, top: 420, width: 343, height: 120 };
    const sheet = { left: 0, top: 552, width: 375, height: 600 };
    const at = placePopup({
      anchor,
      size: { width: 343, height: 300 },
      viewport: phone,
      avoid: [sheet],
    });
    expect(at.side).toBe("above");
    expect(at.top).toBe(108);
  });

  it("beside the tile, centres on the button that opened it", () => {
    const anchor = { left: 100, top: 200, width: 300, height: 500 };
    expect(placePopup({ anchor, size, viewport, near: 600 }).top).toBe(600 - 130);
    // Not above the tile, where the chart is.
    expect(placePopup({ anchor, size, viewport, near: 220 }).top).toBe(200);
  });

  it("keeps a side pop-up on the screen vertically when the tile's top allows", () => {
    const anchor = { left: 100, top: 300, width: 300, height: 480 };
    expect(placePopup({ anchor, size, viewport, near: 760 }).top).toBe(800 - 260 - 8);
  });

  it("with nowhere clear, takes the side that covers least", () => {
    const anchor = { left: 100, top: 300, width: 300, height: 200 };
    const avoid = [
      { left: 0, top: 0, width: 1280, height: 290 },
      { left: 0, top: 510, width: 1280, height: 290 },
      { left: 400, top: 290, width: 880, height: 30 },
    ];
    expect(placePopup({ anchor, size, viewport, avoid }).side).toBe("right");
  });
});

describe("popupLine", () => {
  it("runs from the button's facing edge to the pop-up's near edge", () => {
    const from = { left: 120, top: 500, width: 100, height: 20 };
    const right = popupLine(from, { left: 412, top: 400, width: 320, height: 260 }, "right");
    expect(right.startsWith("M220,510")).toBe(true);
    expect(right.endsWith("412,510")).toBe(true);
    const below = popupLine(from, { left: 16, top: 652, width: 343, height: 300 }, "below");
    expect(below.startsWith("M170,520")).toBe(true);
    expect(below.endsWith("170,652")).toBe(true);
  });
});
