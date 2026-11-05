# The Robinhood connection

A person connects their own Robinhood account, on Robinhood's sign-in page, and Jane reads their
accounts, balances, stocks and funds and filled orders. It's off: `ROBINHOOD_LINK` isn't set anywhere,
and until it's exactly `1` there is no button, and every route answers 404.

## How it stays read-only

Robinhood's connection has one permission, `internal`, which also lets a connection trade in an agent
account if the person opens one. So being read-only is Jane's own rule, in one place:
`src/lib/robinhood/mcp-client.ts` has a list of the tools Jane may call, and refuses anything else
before a request is sent. A test checks no other code calls the server.

| Tool | What Jane reads |
| --- | --- |
| `get_accounts` | which accounts exist, and their type |
| `get_portfolio` | an account's total and its cash |
| `get_equity_positions` | what it holds |
| `get_equity_quotes` | a price, only for a position the answer above gave none for |
| `get_equity_orders` | filled orders, for the tax figures |

These names are from Robinhood's article
[Trading with your agent](https://robinhood.com/us/en/support/articles/trading-with-your-agent/). The
arguments and the fields in the answers aren't published, so `src/lib/robinhood/parse.ts` assumes them.

## What it does with what it reads

- **Account numbers** are dropped at the door. A number is held in memory during a refresh, to ask
  about that account, and is never saved, logged, shown or sent to Claude. Jane recognizes an account
  next time by a keyed hash. Accounts have no mask.
- **Everything else from the server is untrusted text.** Account names are never kept; Jane writes its
  own from the type. Security names are cleaned and capped. Symbols must look like symbols.
- **It's saved like any investment account**, with `source = robinhood`: `Account`, `Security`,
  `Holding`, `InvestmentTransaction`. So `/investments`, the fee, cash and concentration facts and the
  tax figures read it with no new logic. Each is a fact with a confidence percent, through the same
  filter as any real account (`forRealAccount`). `REAL_ACCOUNT_ADVICE` stays false.
- **Crypto and options aren't read yet.** The account's total may include them, in which case the page
  says the holdings don't add up to the balance.
- **Refresh:** daily on the `plaid-sync` cron, with a time limit and a cap. Everything is read and
  checked before anything is saved, so a failure changes nothing. Failures wait longer each time. If
  Robinhood stops accepting the connection, its tokens are wiped, the numbers stay with their date, and
  the page asks them to reconnect. No Claude calls.
- **Disconnect, inactivity and account deletion** delete the tokens and everything read through it.
  Robinhood's metadata has no revocation address today, so Jane can't end the connection on Robinhood's
  side, and the person is told. If one appears in the metadata, Jane uses it.
- `KILL_BANKS` stops new connections and refreshes. Disconnecting keeps working.
- **Turning the switch off again** stops refreshes and hides the box, and people keep what's saved,
  with no way to disconnect until it's back on. Account deletion and the inactivity clean-up still work.
  Before turning it off for good, disconnect everyone (`removeConnection`).

## What must be true before switching on

All three, in writing where it applies:

1. **Robinhood's yes.** Its terms don't say whether an app may connect for its users. Its onboarding
   article lists the platforms it supports and says to contact support for others, so it may also need
   to allow Jane's sign-in address.
2. **Counsel's read** of the Privacy Policy and Terms text, which shows only when the switch is on, and
   of Robinhood's agreement. Robinhood's disclosures have the person assume the risk of what third-party
   AI providers do with their data.
3. **A clean audit round** over this code.

Then the founder's test, below, passes.

## The founder's test

Nothing has ever talked to a real Robinhood account: every test uses `src/lib/robinhood/__fixtures__/fake-robinhood.ts`.
So the first real connection is the test of everything the fake assumes. It needs Robinhood's yes first.

On a scratch database, with the founder's own account, and `ROBINHOOD_LINK=1` only on that local server:

1. Open `/investments`, read the box, and connect. **Don't open the agent account.** Note if Robinhood
   insists on it: the plan depends on it being optional.
2. Note what Robinhood's page asks for, and whether it mentions trading. Jane's text must match it.
3. The box should say Connected, with holdings on the page. If it says the last read didn't work, the
   server log has `Robinhood refresh failed` with a code and, for a wrong assumption, the answer's field
   names without their values. Fix `parse.ts` from those.
4. Compare every balance and holding with Robinhood's own app. Check a sale in the tax figures.
5. Search the database for your account number. Nothing should have it.
6. Wait for the access token to end, then refresh, to see how long it lasts and that renewing works.
7. Disconnect, and check whether Robinhood still lists the connection, and how to remove it there.

## The way back

Robinhood is told `<site>/api/robinhood/callback`, from `APP_URL` (or the Vercel production address).
Keep this path: it's registered with Robinhood, once per address, in `robinhood_oauth_clients`.

## Tests and local runs

`ROBINHOOD_MCP_URL` points at the fake server. It works only for an address on this machine; anything
else is ignored, so a setting can't send a person's tokens elsewhere. `e2e/robinhood.spec.ts` starts its
own production server with the switch on, and needs `E2E_PROD=1`.
