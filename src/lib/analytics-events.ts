export const ANONYMOUS_ID_COOKIE = "fc_aid";

// Events the browser may send to POST /api/events. Server-side events don't need to be listed.
export const CLIENT_EVENTS = [
  "landing_viewed",
  "get_started_clicked",
  "report_viewed",
  "card_opened",
  "link_failed",
  "insights_viewed",
  "alerts_viewed",
  "debt_planner_viewed",
  "plan_viewed",
  "loans_viewed",
  "documents_viewed",
] as const;

export type ClientEventName = (typeof CLIENT_EVENTS)[number];

export function isClientEvent(name: unknown): name is ClientEventName {
  return typeof name === "string" && (CLIENT_EVENTS as readonly string[]).includes(name);
}
