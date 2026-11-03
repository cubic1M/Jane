# Money rules

Checks that hold the money code to account without a person reading it. `npm run check:rules` runs the first three, in CI's static job.

- **Layers** (`.dependency-cruiser.cjs`): library code can't depend on a page, statement readers and detection rules have no database, config is a leaf, pages and rules make no Claude call, the Plaid SDK stays in its corner, paper money touches nothing real, and readers and rules have no cycles. Every rule holds today, so there's no list of known breaks.
- **Dead code** (`knip.json`, `scripts/check-ratchets.mjs`): no unused file or dependency, and no import of an unlisted package. Unused exports and types are capped, since they're too many to clear at once; lower the caps as they go.
- **Strict indexing** (`tsconfig.ratchet.json`): `noUncheckedIndexedAccess` holds in `src/detection`. A cleaned folder is added to the list in `scripts/check-ratchets.mjs` and stays clean.
- **Weak-test finder** (`stryker.config.mjs`, `.github/workflows/mutation.yml`): every Sunday, Stryker changes the money code on purpose and reports each change no test noticed. It reads as a list of places a bug could hide, not a score to reach. It only runs tests that need no database. Run it locally with `STRYKER_WORKERS=2 npm run mutation`.
