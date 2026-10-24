// The Jane, Money and Ahead hubs (spec step 80): how much each summary shows before
// "See all".

// Plan items and open findings under "To decide".
export const HUB_DECIDE_LIMIT = 5;
// Open actions under "In progress".
export const HUB_IN_PROGRESS_LIMIT = 5;
// Finished actions under "Done".
export const HUB_DONE_LIMIT = 3;
// Unread alerts.
export const HUB_ALERTS_LIMIT = 3;
// Deadlines counted on the Ahead hub: the ones in the next this many days.
export const HUB_DEADLINE_DAYS = 30;

// The Plans & goals tree (src/lib/area-pages/plans.ts): dates in the next this many days are
// their own items; within AHEAD_URGENT_DAYS they're urgent.
export const AHEAD_DATES_DAYS = 14;
export const AHEAD_URGENT_DAYS = 3;
