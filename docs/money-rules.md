# Money rules

Checks that hold the money code to account without a person reading it. `npm run check:rules` runs the first three, in CI's static job.

- **Layers** (`.dependency-cruiser.cjs`): library code can't depend on a page, statement readers and detection rules have no database, config is a leaf, pages and rules make no Claude call, the Plaid SDK stays in its corner, paper money touches nothing real, and readers and rules have no cycles. Every rule holds today, so there's no list of known breaks.
- **Dead code** (`knip.json`, `scripts/check-ratchets.mjs`): no unused file or dependency, and no import of an unlisted package. Unused exports and types are capped, since they're too many to clear at once; lower the caps as they go.
- **Strict indexing** (`tsconfig.ratchet.json`): `noUncheckedIndexedAccess` holds in `src/detection`. A cleaned folder is added to the list in `scripts/check-ratchets.mjs` and stays clean.
- **Weak-test finder** (`stryker.config.mjs`, `.github/workflows/mutation.yml`): every Sunday, Stryker changes the money code on purpose and reports each change no test noticed. It reads as a list of places a bug could hide, not a score to reach. It only runs tests that need no database. Run it locally with `STRYKER_WORKERS=2 npm run mutation`.

## Statements have to add up

`src/data-sources/csv/control-totals.ts` checks every statement as it's read, before anything is worked out from it:

- **Running balance:** each day's closing balance has to be the last one less what moved since, in any row order. An export may leave a pending row's balance empty or print one only at the day's end, and either reading passes.
- **Stated totals:** opening plus the rows has to equal closing, and the money in, money out, footer total and row count a statement gives have to match its rows.
- **Signs:** the amounts have to run with the balance. With no balance, they have to run with what the rules recognize (on a card, most rows are purchases) and with an OFX file's own debit and credit labels.
- **Row counts:** every row in a file is read, unreadable or left out on purpose: `inFile = read + skipped + leftOut`. An OFX file cut off mid-download, or a bank id used twice with different amounts, says so.

What doesn't add up is a warning on the preview, on the saved line and on the upload's row in the history (`import_runs.control_warnings`), in figures and dates only. A balance column that doesn't follow from most of its rows isn't used as a balance, so the account asks for it instead. Picked columns that run against the file's own balance are refused on a bank account, because the person can pick the other sign.

## Properties

fast-check holds these for any made-up rows, in the ordinary test run:

- `src/detection/money.property.test.ts`: each finding's dollars recompute from its own transactions, findings show only real rows, and row order changes nothing. Money between someone's own accounts nets to zero, is never spending or income, and leaves net worth alone every day. A month's spending is what its categories and refunds add up to.
- `src/lib/import/double-import.integration.test.ts`: a second upload adds nothing, two overlapping files equal one whole file, and real repeats within a file stay.
- `src/data-sources/csv/control-totals.property.test.ts`: a statement that adds up says nothing in either order, taking out any row warns, and every row is accounted for.
- `src/lib/money.property.test.ts`: amounts read back as written.

## Constraints in the database

`prisma/migrations/*_money_check_constraints` adds 35 CHECK constraints, for example: a budget, a goal and a transfer are above zero, a percent is 0 to 100, and an invite's uses stay within its limit.

- **Chosen by reading the writers.** Each predicate comes from what the code can write, never from production's data. Left out because a writer can break them: `holdings.quantity` (Plaid and CSV report short positions), `findings.amount_cents` (a low-balance forecast is negative), `credit_reports.score` and `brokerage_orders.amount_cents`. Also left out: "an uploaded row has a dedupe key". It holds in production, where one writer sets it from a required field, but it failed 37 tests whose fixtures plant uploaded rows with no key, so it would only have policed fixtures.
- **`NOT VALID`.** Each applies to every new or changed row at once and scans nothing, so the migration is safe on any existing rows. A later migration can `VALIDATE` them only where `scripts/sql/money-constraints-old-rows.sql` counts 0 in production, which a founder runs.
- **Tested both ways.** `src/lib/money-constraints.integration.test.ts` shows each rule accepting a good value and refusing a bad one by name, and fails if a `ck_` constraint has no case.
