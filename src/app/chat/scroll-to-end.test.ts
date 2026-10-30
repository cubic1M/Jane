import { describe, expect, it } from "vitest";
import { atEnd, END_SLACK_PX } from "./scroll-to-end";

// The chat stays at its newest message while its size changes, until the person scrolls up.
describe("atEnd", () => {
  it("is at the end at the bottom and within a little of it", () => {
    expect(atEnd({ scrollTop: 700, scrollHeight: 1000, clientHeight: 300 })).toBe(true);
    expect(atEnd({ scrollTop: 700 - END_SLACK_PX, scrollHeight: 1000, clientHeight: 300 })).toBe(
      true,
    );
  });

  it("isn't once the person has scrolled up to read", () => {
    expect(atEnd({ scrollTop: 600, scrollHeight: 1000, clientHeight: 300 })).toBe(false);
    expect(atEnd({ scrollTop: 0, scrollHeight: 1000, clientHeight: 300 })).toBe(false);
  });

  it("is when everything fits", () => {
    expect(atEnd({ scrollTop: 0, scrollHeight: 300, clientHeight: 300 })).toBe(true);
  });
});
