# Real daily closes: a research fixture

`closes.csv` holds daily closes, adjusted for splits and dividends, for every ticker a practice
portfolio may hold (`PRACTICE_UNIVERSE` in `src/config/portfolios.ts`). It is used by the rule
replay's tests and tuning (`src/planning/rule-replay*.ts`, `docs/backtests/log.md`) so they run
on real history with no network call. Data only: nothing here is code, and the app never reads it.

- Source: Yahoo Finance's keyless chart API (`query1.finance.yahoo.com/v8/finance/chart/<TICKER>`,
  `interval=1d`), the `adjclose` series. Stooq's CSV download, the first choice, now asks for a
  browser check, so it wasn't used. Production replays use the stored Alpaca history instead.
- Range: 2016-01-04 to 2026-10-21 (2,716 trading days); dates are the New York trading day.
- Downloaded: 2026-10-22.
- Columns: `date`, then one column per ticker in dollars to 4 decimal places (blank: no close).
- Tickers in `closes.csv`: VTI, VXUS, BND, BIL (the model funds), ITOT, IXUS, AGG (their swap
  partners), AAPL, MSFT, NVDA, TSLA (the watched companies).
- `universe.csv` (same source and shape, downloaded 2026-10-23, 2016-01-04 to 2026-10-21): the
  rest of the strategy universe (`STRATEGY_ASSETS` in `src/config/portfolios.ts`): VBR, VEA, VWO,
  SHY, IEF, TLT, TIP, VNQ, GLD.
- `themes.csv` (same source and shape, downloaded 2026-10-24, 2016-01-04 to 2026-10-21): the funds
  the news themes point to (`THEMES` in `src/config/themes.ts`) not already above: XLE, USO, ITA,
  SMH. Used to backtest each theme on its past events (`src/planning/themes.ts`).
- `menu.csv` (same source and shape, downloaded 2026-10-24, 2016-01-04 to 2026-10-21): the funds
  the strategy menu uses (`MENU_STRATEGIES` in `src/config/strategy-menu.ts`) not already above:
  VTV, MTUM, QUAL, VIG, RSP (factor, dividend and equal-weight US stocks), XLB, XLF, XLI, XLK, XLP,
  XLU, XLV, XLY (the sector funds besides XLE), DBC (commodities).
- `crypto.csv` (Yahoo Finance's BTC-USD and ETH-USD daily closes at 00:00 UTC, downloaded
  2026-10-24, 2018-01-01 to 2026-10-21, every calendar day): read apart, by `realCryptoBars()`.
- Not refreshed automatically. To refresh, fetch the same series and rewrite the file in the
  same shape; record the new range and date here and in `docs/backtests/log.md`.
