// The monthly close page (/close/[month], src/planning/close.ts).

// At most this many "what matters now" chips on top (docs/design/area-pages.md).
export const CLOSE_CHIPS_MAX = 3;

// Changes (src/insights/changes.ts) only look back a couple of weeks from a day, so a month's
// changes are read as of these days of it (and its last day), and put together.
export const CLOSE_CHANGE_DAYS: readonly number[] = [10, 20];
