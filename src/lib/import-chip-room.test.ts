import { describe, expect, it } from "vitest";
import { CHIP_ROOM_COOKIE, chipRoomCookie, hasChipRoom } from "./import-chip-room";

// Mobile pass (11-16): the upload notice keeps its room from the page's first HTML while it shows,
// so the page doesn't move down for it on every load. The cookie only says whether it's showing.
describe("the upload notice's room", () => {
  it("is kept while it shows, for a day at most, and nothing else is in the cookie", () => {
    expect(chipRoomCookie(true)).toBe(`${CHIP_ROOM_COOKIE}=1; Path=/; Max-Age=86400; SameSite=Lax`);
    expect(hasChipRoom("1")).toBe(true);
  });

  it("goes when it's gone", () => {
    expect(chipRoomCookie(false)).toBe(`${CHIP_ROOM_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax`);
    expect(hasChipRoom("")).toBe(false);
    expect(hasChipRoom(undefined)).toBe(false);
  });
});
