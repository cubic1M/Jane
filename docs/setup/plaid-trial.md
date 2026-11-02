# Run on Plaid's free Trial plan

Plaid's Trial plan gives real Production data for free, for up to 10 Items. Jane keeps count so it
stops before Plaid does. Plaid's rules are at <https://plaid.com/docs/account/billing/>.

## What counts

- An Item is one bank login, not one person. Every Production access token counts.
- Removing an Item with `/item/remove` does not give it back, and duplicate Items count too.
- Sandbox and the demo bank never count, and neither does a Link someone abandons: Jane counts
  when Link's token is exchanged.
- Reconnecting a bank (Link's update mode) reuses the same Item, so it never counts and always
  works.

## How Jane uses them

- 10 in all, 1 per person, so the 10 can serve 10 people.
- At either limit, `/connect` says "Bank linking is full for now. Upload a statement instead."
  People with a linked bank carry on as before.
- A person's one is spent for good too: if they disconnect their bank, or it is removed after 60
  days without use (`INACTIVE_ITEM_DAYS`), linking again falls back to upload. Deleting an account
  deletes their record, and the count stays. A person who signs up again is treated as new, and
  spends another of the 10.
- The count is on `/admin/numbers` and `/admin/launch` ("N of 10 bank connections used"). The team
  is emailed once at 8 of 10 by the daily health check.
- Trial people (sample data) can't link a real bank in Production. They keep the demo bank.

## Founders: test in Sandbox

Don't link your own banks in Production to try things: it spends slots you can't get back. Use
`PLAID_ENV=sandbox` locally, or the demo bank.

Before the first real person, compare the count with the Plaid dashboard. Jane starts counting at 0
when this ships, so it can't see Items made in Production before then. If there are any, lower
`PLAID_TRIAL_ITEM_LIMIT` by that many.

## Upgrading

1. In the Plaid dashboard, open the Plans page and upgrade. Read what Plaid says first: you keep
   Production access only to the products on your Production request, and subscription-billed
   products added during the trial start billing.
2. In Vercel, set `PLAID_TRIAL_ITEM_LIMIT` to the new limit, high enough to never be the thing that
   stops you, and `PLAID_ITEMS_PER_PERSON` to how many banks each person may link.
3. The next deploy picks them up. Check `/admin/launch` afterwards.

A value that isn't a whole number is ignored and the Trial limits stay, so a typo can't remove the
limit. `/admin/launch` flags it.
