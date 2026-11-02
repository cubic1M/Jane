// How many Plaid Production Items Jane may create (src/lib/plaid/item-slots.ts,
// docs/setup/plaid-trial.md). Plaid's Trial plan allows 10 ever: an Item is one bank login, every
// Production access token counts, and removing one doesn't give it back.

export const PLAID_TRIAL_ITEM_LIMIT = 10;
// One each, so the 10 can serve 10 people. A second bank falls back to uploading a statement.
export const PLAID_ITEMS_PER_PERSON = 1;
// The team is emailed, and a line logged, from this share of the limit on: 8 of 10.
export const PLAID_ITEM_WARN_SHARE = 0.8;

// What a person is told when no new bank can be linked.
export const LINKING_FULL_WORDS = "Bank linking is full for now.";
export const LINKING_UPLOAD_WORDS = "Upload a statement instead.";
export const LINKING_TRIAL_WORDS = "Linking a real bank isn't part of trying Jane.";
export const LINKING_FULL_CODE = "linking_full";

// A whole number from the environment, for after an upgrade to a paid plan. Anything else keeps
// the Trial plan's limit, so a typo can never mean "no limit".
function limitFromEnv(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  return raw && /^\d+$/.test(raw) ? Number(raw) : fallback;
}

export const plaidItemLimit = () => limitFromEnv("PLAID_TRIAL_ITEM_LIMIT", PLAID_TRIAL_ITEM_LIMIT);
export const plaidItemsPerPerson = () =>
  limitFromEnv("PLAID_ITEMS_PER_PERSON", PLAID_ITEMS_PER_PERSON);
export const plaidItemWarnAt = (limit: number) => Math.ceil(limit * PLAID_ITEM_WARN_SHARE);
