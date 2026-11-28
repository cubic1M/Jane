// The chat when Claude can't be reached (src/lib/jane-agent/service-down.ts).

// The server logs it once per this many minutes however many people ask meanwhile; every one is
// still recorded as an ops event for /admin/health.
export const CHAT_MODEL_DOWN_LOG_MINUTES = 10;
// /admin/health's red line counts and dates this far back.
export const CHAT_MODEL_DOWN_HOURS = 24;
