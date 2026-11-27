# The law-change process (Tax T32)

How Jane gets a new tax year's figures, and how it notices when they are missing. The list of
sources is in code, `src/config/tax-params/watch.ts` (`TAX_YEAR_SOURCES`); this page is the
checklist built on it, and `src/lib/invariants/tax-year-ready.test.ts` fails if a source is on one
and not the other.

## What the nightly check does

`taxYearReady` (`src/lib/invariants/nightly.ts`) runs every night in the invariants job and again in
the daily health email. It works on the day on the furthest-ahead clock (UTC+14), so it warns when
the first person's day reaches the date.

| Day | Figures for that year | Result |
|---|---|---|
| any day | the current year is missing | red: the invariant is broken, the team is alerted, and the line is in the accuracy email every day |
| from `TAX_PARAMS_LEAD_DAYS` (31) days before January 1, so December 1 | the coming year is missing | warning: in the accuracy email on Mondays only (every day if the email goes out anyway for an accuracy reason) |
| any day | a draft year, or a figure read from an IRS draft, was last read more than `TAX_DRAFT_MAX_DAYS` (60) days ago | warning: in the accuracy email on Mondays only (every day if the email goes out anyway for an accuracy reason) |
| any day | a supported year has an AWAITED group (its source has not published it yet; today the 2027 mileage rate) | warning naming the group, never red: the year prices normally and only the figure that needs the group is held back. Older than `TAX_DRAFT_MAX_DAYS` since it was last read: "look again at its source". Same Monday rule |

Only years and group names are written: nothing about a person. Sample (trial) people and analytics
are not touched. Both limits are in `src/config/invariants.ts`.

The red line is January 1, when income starts to count toward the new year. The tax pages and the
default tax year flip later, on May 1 (`defaultTaxYear`, `TAX_PACK_LAST_YEAR_UNTIL` is 04-30), so
red comes four months before the app would show a year with no figures, and the December 1 warning
five months before.

## When each source usually appears

A window is general knowledge unless the row says it was read at the source.

| Key | Source | Usual window | Read at the source |
|---|---|---|---|
| `inflation_rev_proc` | https://www.irs.gov/newsroom (the Revenue Procedure with next year's inflation-adjusted amounts) | October to early November | 2027: Rev. Proc. 2026-35, news release IR-2026-133, 2026-11-05 |
| `pub_15t` | https://www.irs.gov/publications/p15t (the withholding adjustment and the percentage-method tables; an early draft is posted at the IRS drafts page first) | December of the year before, usually | 2027: the final is not out (the page says For use in 2026); the early draft p15t--dft.pdf, read 2026-11-27, still carries 2026's $8,600 and $7,500 band (16,100), not the 2027 standard deduction of 16,600, so it is not used |
| `retirement_notice` | https://www.irs.gov/retirement-plans/cola-increases-for-dollar-limitations-on-benefits-and-contributions | late October to mid November | 2027: Notice 2026-66, news release IR-2026-136, 2026-11-12 |
| `hsa_rev_proc` | https://www.irs.gov/irb | spring (May or June of the year before) | 2027: Rev. Proc. 2026-24, Internal Revenue Bulletin 2026-25, 2026-06-15 |
| `ss_wage_base` | https://www.ssa.gov/oact/cola/cbb.html | mid October, with the cost-of-living announcement | 2027: $192,300, press release of 2026-10-14 |
| `mileage_notice` | https://www.irs.gov/tax-professionals/standard-mileage-rates | December, a notice and a news release | 2027: not published on 2026-11-27 (the page ends at the July 2026 rate) |
| `draft_forms` | https://www.irs.gov/draft-tax-forms | late summer to December; the final instructions follow in January | general knowledge |
| `final_instructions` | https://www.irs.gov/forms-instructions | January | general knowledge |
| `tax_legislation` | https://www.congress.gov/ | any time: check after every bill, and read each Code section a figure cites | general knowledge |
| `irs_newsroom` | https://www.irs.gov/newsroom | weekly from October to February, monthly otherwise | general knowledge |
| `ftb_tables` | https://www.ftb.ca.gov/forms/ | late December | general knowledge |
| `ftb_news` | https://www.ftb.ca.gov/about-ftb/newsroom/tax-news/ | October (the first announcement of the next year's amounts) | general knowledge |
| `oracle_changelogs` | https://github.com/PSLmodels/Tax-Calculator/releases | weekly from October to February, monthly otherwise | general knowledge |

## The yearly checklist

1. October to November: read `inflation_rev_proc`, `retirement_notice`, `ss_wage_base`; in
   December `mileage_notice` and `pub_15t`. Write `us-<year>.ts` following `us-2026.ts`: one `Cited` group per
   figure with its source address, the place in it, the day read and the status. A figure that its
   source has not published yet is an AWAITED group (`awaited(year, key, {...})` in
   `src/config/tax-params/awaited.ts`): it holds no value, its note says what is awaited and when
   it is usually out, and reading `.value` throws `NoTaxParamsError` carrying the year and the
   group. It is never a zero, never copied from the year before, never a guess.
2. A year is SUPPORTED (in `FEDERAL` and `SUPPORTED_TAX_YEARS`) when every group is either verified
   at its source or awaited. Everything else of the year prices normally from the first day; the
   one figure that needs an awaited group says so in its own words (for the mileage rate: "Jane
   doesn't have the IRS's 2027 mileage rate yet, so it hasn't counted those miles.") and shows no
   number. The nightly check only warns (never red) while a supported year has an awaited group,
   naming it, and says "look again" when one has not been read for `TAX_DRAFT_MAX_DAYS`. A year with a group that
   is neither verified nor awaited goes in `DRAFT` and is not priced at all. When an awaited group
   is published, replace `awaited(...)` with `cited(...)`, set it `verified`, write the fingerprint
   and the bench cases that use it, delete the note, and turn the 2027 "awaited" assertions
   (`src/planning/mileage-readers.test.ts`, `src/config/tax-params/us-2027.test.ts`,
   `src/lib/invariants/tax-year-ready.test.ts`'s "today" case, the surface tests for 2027) into
   priced ones.
3. Second reading: a figure becomes `verified` when the Revenue Procedure (or the statute) and the
   form instructions agree. If they conflict the statute wins and the conflict goes in `where`.
   Write the hand examples as `us-<year>.test.ts` (one per filing status).
4. January: read `final_instructions` against every table (Tax Table, EIC table, the capital gain
   worksheet).
5. When every group is verified or awaited: move the year from `DRAFT` to `FEDERAL`, add it to
   `SUPPORTED_TAX_YEARS`, write the fingerprint (`PARAMS_VERSION_WRITE=1 npx vitest run
   src/config/tax-params/params.test.ts`), extend the test's key and note lists, and satisfy the
   accuracy bench: `src/tax-bench` requires a passing case for every figure of a supported year
   (`coverage.test.ts`) and probes for every group (`ESTIMATOR_YEARS` in `serialize.ts`).
6. After any federal or California tax bill: run the `tax_legislation` check, and read each Code
   section a figure cites (`feeds` in `watch.ts` says which groups depend on which source).
7. Put the dates read in the `seen` list of the source, and update this table.
