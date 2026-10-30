import { describe, expect, it } from "vitest";
import { atEnd, END_SLACK_PX, stillFollowing } from "./scroll-to-end";

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

// Night debugger: scrolled up while the sheet was still sliding open, the chat was pulled back
// down, the scroll heard only after the resize.
describe("stillFollowing", () => {
  const page = (scrollTop: number, scrollHeight = 3000, clientHeight = 400) => ({
    scrollTop,
    scrollHeight,
    clientHeight,
  });

  it("follows on as the chat or its frame changes size under it", () => {
    // Content grew under it: no longer at the end, but where it was left.
    expect(stillFollowing(true, page(2600, 3200), 2600)).toBe(true);
    // The frame shrank: the same.
    expect(stillFollowing(true, page(2600, 3000, 300), 2600)).toBe(true);
    // The frame grew and the browser pulled it up to the new end.
    expect(stillFollowing(true, page(2400, 3000, 600), 2600)).toBe(true);
  });

  it("stops once the person has scrolled up, heard or not", () => {
    expect(stillFollowing(true, page(0), 2600)).toBe(false);
    expect(stillFollowing(true, page(1800), 2600)).toBe(false);
  });

  it("never starts again on its own", () => {
    expect(stillFollowing(false, page(2600), 2600)).toBe(false);
  });
});
