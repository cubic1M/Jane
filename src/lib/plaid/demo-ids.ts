// The demo bank's items: each Plaid item id starts "demo-" (src/lib/plaid/demo.ts links them). Here,
// apart from demo.ts, so code that only asks "is this the demo bank?" doesn't load the demo bank.
export const DEMO_ITEM_PREFIX = "demo-";

export const isDemoItemId = (plaidItemId: string) => plaidItemId.startsWith(DEMO_ITEM_PREFIX);
