// CardSavvy (batch-2 keyless sources, 11-19; card-savvy.com/mcp, its API Terms at card-savvy.com/terms/api
// updated 2026-07-30, and the MCP server's own tools/list, read 2026-11-19): each credit card's earn rates,
// fee and point value, from its catalog, with no account ("no account is needed for the catalog"). The
// terms license calling it to "display its responses within your own product or workflow, including for
// commercial purposes", ask to "attribute them to CardSavvy and preserve the verification date", and may
// require "a separate written agreement for high-volume use". Anonymous callers get 120 tool calls an
// hour, so a card is looked up once a day at most. Only a card's name is sent: never the person's
// spending, which stays in Jane.
export const CARDSAVVY = {
  endpoint: "https://mcp.card-savvy.com/mcp",
  protocolVersion: "2025-06-18",
  // A card's terms read once are reused for this long.
  cacheHours: 24,
  attribution: "CardSavvy",
  // CardSavvy's categories (get_card's `rewards`) for each kind of spending Jane counts.
  categoryOf: {
    dining: "Dining",
    groceries: "Grocery",
    gas: "Gas",
    travel: "Other Travel",
    streaming: "Streaming",
    online: "Online Shopping",
  },
  baseCategory: "Other",
} as const;
