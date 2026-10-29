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

// Told on the page's window when the person's data changed under it (an upload finished): the
// side chat reloads, and with it Jane's cards (demo-video list: the chat said "Upload your bank
// statements" next to "We found $813/yr" until a full reload).
export const DATA_CHANGED_EVENT = "jane:data-changed";
// Told on the page's window when the framed chat's cards changed: the dock above it reloads.
export const CARDS_CHANGED_EVENT = "jane:cards";

// The phone's Jane button tucks away while scrolling down (src/lib/side-chat.ts, fabTucked):
// never within this far of the top or the end, and not for a move smaller than the slack.
export const FAB_TOP_PX = 80;
export const FAB_END_PX = 80;
export const FAB_SCROLL_SLACK_PX = 8;

// The unread dot is checked this often while the chat is out of sight.
export const UNREAD_POLL_MS = 60_000;
