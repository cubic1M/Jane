// The side chat (docs/design/home-hub.md): the docked panel on a computer and the bottom sheet
// on a phone.

// The panel docks from this width up; below it the chat is a bottom sheet.
export const SIDE_CHAT_MIN_WIDTH_PX = 1024;

// The bottom sheet's resting heights, as shares of the screen's height.
export const SHEET_HALF = 0.5;
export const SHEET_FULL = 0.92;
// Let go of a drag faster than this (px per ms) and the sheet follows the flick; slower, it
// snaps to the nearest resting height. Below this share of the screen it closes.
export const SHEET_FLICK_PX_PER_MS = 0.5;
export const SHEET_CLOSE_BELOW = 0.25;

// The unread dot is checked this often while the chat is out of sight.
export const UNREAD_POLL_MS = 60_000;
