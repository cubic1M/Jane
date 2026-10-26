# Recorded events data: a research and test fixture

Data only: the app never reads these files. The events overlay's backtest
(`src/lib/events/__fixtures__/backtests.ts`, `docs/backtests/events.md`) and its contract tests
(`src/lib/events/feeds.test.ts`) run on them with no network call.

- `gdelt-coverage.csv`: GDELT DOC 2.0 (`api.gdeltproject.org/api/v2/doc/doc`, `mode=timelinevolraw`,
  free and keyless), one request per event type for its query in `EVENT_TYPES` (`src/config/events.ts`),
  2017-01-01 to 2026-10-25 at daily resolution, recorded 2026-10-26. Columns: `date` (the UTC day),
  `total` (all articles GDELT monitored that day: the same in every type's answer), then each
  type's article count, the nine stock-fund types then the five crypto types (those recorded
  2026-10-26 too, with the same range). A type's query changed in the config needs this file
  refetched.
- `gdelt-me-conflict-2017.json`: the first 45 days of one recorded GDELT answer as it came, for
  the parser's contract test.
- `fed-monetary.xml`: the Federal Reserve's monetary policy press releases RSS
  (`federalreserve.gov/feeds/press_monetary.xml`), recorded 2026-10-26.
- `fomc-2026-09-16.html`: the statement part of the September 16, 2026 FOMC statement page
  (the Committee raised the target range), recorded 2026-10-26.
- `bls-cpi.xml`: BLS's CPI releases Atom feed (`bls.gov/feed/cpi.rss`), recorded 2026-10-26.
- `eia-today.xml`: EIA's Today in Energy RSS (`eia.gov/rss/todayinenergy.xml`), recorded 2026-10-26.

Not refreshed automatically. GDELT asks for one request every 5 seconds; a fetch of the whole
range per type answers in one request at daily resolution.
