import type { PlaidApi } from "plaid";

// The Plaid client for the demo bank, which never calls Plaid: anything that tried fails here.
export const NO_PLAID = new Proxy(
  {},
  {
    get: () => () => {
      throw new Error("The demo bank must never call Plaid");
    },
  },
) as PlaidApi;
