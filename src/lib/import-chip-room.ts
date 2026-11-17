// The upload notice on a phone takes its own room at the top of the page (src/components/
// import-chip.tsx). It learns what to say after the page draws, so the page would move down for it
// on every load while it shows (66 px, and a tap aimed a moment before lands on the wrong thing).
// While it shows, a cookie says so, with nothing else in it: the next page's HTML keeps its room
// from the start (src/app/layout.tsx), and nothing moves.
export const CHIP_ROOM_COOKIE = "jane_import_chip";

export const hasChipRoom = (value: string | undefined) => value === "1";

export function chipRoomCookie(showing: boolean): string {
  return showing
    ? `${CHIP_ROOM_COOKIE}=1; Path=/; Max-Age=86400; SameSite=Lax`
    : `${CHIP_ROOM_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax`;
}
