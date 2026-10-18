// Devices and sessions (spec step 73).

// A session's "last active" time is written at most this often, so ordinary page views
// don't write to the database each time.
export const SESSION_SEEN_EVERY_MINUTES = 10;

// The browser's user agent is kept only this long, and only to name the device.
export const USER_AGENT_MAX_LENGTH = 300;

// "Last active" within this many minutes reads as "Active now".
export const ACTIVE_NOW_MINUTES = 15;
