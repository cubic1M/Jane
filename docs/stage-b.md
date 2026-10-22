# Stage B: the partner swap

Stage A (Phase AW, steps 288–297) runs automated investing on practice money: a paper ledger,
the sample market, demo advice only, `REAL_ACCOUNT_ADVICE = false`. Stage B puts a licensed
broker-dealer or RIA partner behind the same code. This is the exact list of what the swap
needs. Nothing on it is built yet, and none of it ships without the founder and counsel.

What stays as built: the five levels and the questionnaire (`src/planning/practice-level.ts`),
the model portfolios (`src/config/portfolios.ts`), the autopilot's plan (`planTrades`), the
daily scan (`src/planning/practice-scan.ts`), the trade log, the pause switches, the cards and
the chat answers.

## 1. Decisions that come first (founder and counsel)

- **The partner, and who is the adviser of record.** Jane recommends and the partner executes
  (a broker-dealer), or the partner is the RIA and Jane is its interface. That choice decides
  the disclosures (Form CRS, Form ADV Part 2), the suitability records and who signs off on the
  model portfolios.
- **`REAL_ACCOUNT_ADVICE`** (`src/config/advice.ts`) is revisited with counsel. Until it
  changes, real accounts get facts only, and every Stage A path stays behind `adviceMode`.
- **CLAUDE.md's "no money movement, no investing" rule** changes in the same PR as the swap,
  with the founder's sign-off. Stage A never moves money.
- **Every number marked FOR REVIEW** is signed off before it touches real money:
  - `MODEL_PORTFOLIOS` and `TARGET_MIXES`;
  - `AUTOPILOT_LIMITS`;
  - `SCAN_CAPS`, `DIP_MIN_DROP`, `HARVEST_MIN_LOSS_SHARE`, `OPPORTUNITY_MAX_SHARE` and the
    news patterns (`src/config/practice-scan.ts`);
  - `SCAN_CONFIDENCE`;
  - `HARVEST_PARTNERS` (whether ITOT, IXUS and AGG are "not substantially identical" for the
    wash-sale rule is a question for the tax adviser).

## 2. The broker adapter (one file)

- A `PartnerBroker` beside `PaperBroker` in `src/lib/practice/broker.ts`, implementing
  `Broker`. `practiceBroker()` picks it from config, never per request. The interface gains:
  - `cancel(orderId)`, as the spec names it;
  - an order status (`placed`, `filled`, `partly_filled`, `rejected`, `cancelled`), because
    real fills aren't instant.
- `placeOrder` today returns a fill at the day's close. A real order is placed, then filled
  later. That needs:
  - an order row with the partner's order id and status (a `PracticeTrade` gains
    `externalId` and `status`, or a sibling `BrokerOrder` table);
  - a webhook or poll that records the fill price and quantity;
  - the ledger state rebuilt from fills, not from orders.
- Orders are notional (dollars), as the plan makes them. The partner must support fractional,
  dollar-amount orders, or the plan rounds to whole shares (`planTrades` would then carry
  quantities).
- **Timing.** The cron runs after the close (`/api/cron/practice-scan`, 21:30 UTC), so real
  orders queue for the next open. Holidays, halts, partial fills and rejected orders each need
  a reason in the log, and they never retry silently.
- **Hard limits stay in Jane's code**, checked before every order (`violates`), even if the
  partner checks too.

## 3. Accounts, keys and records

- Account opening and KYC happen at the partner, in the partner's flow. Jane never creates an
  account (Stage A rule). Jane stores the partner's account id per user, encrypted with
  AES-256-GCM under `TOKEN_ENCRYPTION_KEY`, as Plaid tokens are, and never logs or returns it.
- New env vars, added to `.env.example`:
  - the partner's API key and secret, and its environment (sandbox or live);
  - its webhook signing secret.
- The questionnaire answers and the level they gave become the suitability record: stored with
  the date, the version of `TARGET_MIXES` and the reason sentence. That's already shown, but it
  isn't kept per change today.
- `audit_log`: real orders, fills, cancels, pauses and level changes get their own events
  (`practice_trade` stays for paper). They're added to `src/lib/team-access.ts`.

## 4. Market data

- Set `ALPACA_API_KEY_ID`, `ALPACA_API_SECRET_KEY` and `ALPACA_DATA_FEED`, plus
  `EDGAR_USER_AGENT` for filings. `marketData()` switches to Alpaca by itself. Set
  `ANTHROPIC_MODEL_NEWS` to turn on Claude news summaries (step 293).
- Run `/api/cron/market-history` once. It loads `historyTickers()`, which is the model ETFs
  only today. **Add the swap partners** (ITOT, IXUS, AGG) and the watched stocks, so the scan
  and the backtests (step 295) have real closes for everything the ledger can hold.
- The sample market stays for tests and the Try Jane people. It must never price a real order:
  `PartnerBroker` takes its prices from the partner's fills, not from `marketData()`.

## 5. Taxes and lots

- Stage A keeps one position per fund at average cost, and builds lots from the practice trades
  (`lotsFor`). With real money, lots and cost basis come from the partner, and the 1099-B is
  the record.
- The wash-sale check must look at **every account the person has**: Plaid investment
  transactions, the 401(k), IRAs and dividend reinvestment, not only the practice ledger.
  `washReplacements` in `src/planning/investment-taxes.ts` already takes buys from any account;
  the scan has to be fed them.
- A harvest only runs in a taxable account. The scan has to know the account type.

## 6. What the person sees

- The label changes from "Demo advice: sample data, not financial advice" to the partner's
  required disclosure. Cards and chat answers keep a percentage, a reason and the caps.
- A card's button still opens only the details or the pause switch. Approving a real trade is
  a separate, explicit flow, if counsel requires one.
- Pausing must stop orders not yet sent, and say plainly what was already placed.

## 7. Tests the swap adds

- A contract test of `PartnerBroker` against recorded partner responses (place, fill, partial
  fill, reject, cancel), as the Alpaca adapter has.
- A test that no code path places a real order without an advice-mode and counsel-approved
  flag, and that the paper broker stays the default.
- A test that a real order breaking `AUTOPILOT_LIMITS` is never sent.
- A test of the wash-sale check across a real account and the practice ledger.
- Zero calls to the partner in the unit suite, enforced like the Anthropic guard
  (`src/test-setup/no-anthropic.ts`).
