// Concierge queue rules (see the spec's Concierge back office section).

// Every action should be picked up within this many business days.
export const TURNAROUND_BUSINESS_DAYS = 1;

// Upper bound on logged minutes for one action, to catch typos (e.g. 1500 for 15).
export const MAX_MINUTES_PER_ACTION = 600;

// Longest text the team can enter for what the user must do, notes and failure reasons.
export const MAX_TEAM_TEXT = 2000;

// Who Jane acts for (read-only mode). The MVP has no concierge team: for real accounts Jane
// reads and analyses, and the person does the action themselves with her steps and drafts.
// The demo bank and Try Jane's sample people keep the full flow (the agent and the queue), so
// the demo shows everything. Real accounts stay off until there's a team to act for them.
export const CONCIERGE_ACTIONS = { realAccounts: false, demo: true } as const;
