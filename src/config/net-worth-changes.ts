// The net worth chart's "Changes" view (founder, Nov 28: a $9 day and a $138 day must not look the
// same just because net worth is $20,000): one bar per period, how much net worth moved in it.
// The numbers live here; the maths is src/components/hub/net-worth-changes.ts.

// One bar per day while the days on screen are at most this many (about 3 months), one per week up
// to WEEK_BARS_MAX_DAYS (about a year), one per month beyond.
export const DAY_BARS_MAX_DAYS = 92;
export const WEEK_BARS_MAX_DAYS = 400;

// The bar scale is a power of the amount, the same each side of zero: height ~ dollars ** 0.45.
// With a -$18,000 day and a +$9,000 day on screen a $9 bar is still about 4px and a $138 bar about
// 3.4 times taller, where a straight scale made both under a pixel. 0.5 (a square root) would put
// the $9 bar at about 3px on the same chart; 0.45 leaves a margin on a phone.
export const CHANGE_EXPONENT = 0.45;

// The least the scale spans, in cents ($50 of change): a stretch where nothing moved is a line
// in the middle, and a $2 wobble is not blown up into a cliff.
export const CHANGE_FLOOR_CENTS = 5_000;

// Where the person's choice of view is remembered on this device.
export const CHART_VIEW_STORAGE_KEY = "jane.netWorthChart.view";
