# Performance (phones)

Founder, 2026-10-26: "make Jane fast on phones". This page is the baseline, how to measure it, and
the budget CI holds. Numbers are re-measured after each change and added to the "After" tables
with the pull request that earned them.

## How it is measured

A **production** build (`next build` then `next start`, never `next dev`) of main, on a scratch
Postgres on the same machine (so no database latency: production is slower per query, and the
statement counts below matter more there). A Try Jane sample person ("family") is the signed-in
visitor; the landing page is measured signed out. Lighthouse 12, mobile preset (Moto G Power
screen, simulated slow 4G: 150 ms RTT, 1.6 Mbit/s, and a 4x CPU slowdown), performance category
only, one run per page after one warm-up request.

```
npm run build && npx next start -p 3107          # with TRY_JANE=1 DEMO_BANK=1 for the landing form
lighthouse http://localhost:3107/home --form-factor=mobile \
  --extra-headers='{"Cookie":"authjs.session-token=<the sample person's token>"}'
```

- **LCP**, **CLS**, **TBT** (total blocking time) and **TTI** are Lighthouse's own.
- **INP** (interaction to next paint) is not available in a Lighthouse page-load run. TBT is the
  load-time stand-in; taps are timed separately in the browser (a tap on the Home tree, the
  net-worth ranges and "Use this strategy" paint in 15 to 60 ms in a production build).
- **JS** is the transferred (gzip) size of all scripts the page loaded. **First-load JS** is
  Next's uncompressed figure per route (`.next/diagnostics/route-bundle-stats.json`), the number
  CI holds.
- **Statements** is how many SQL statements one warm render of the page issues (counted from
  Postgres's own transaction counter), the number that scales with production's database
  latency.

## Baseline (main at d65b85ed, 2026-10-26)

| Page | Perf | FCP | LCP | CLS | TBT | TTI | JS (gzip) | Page weight | First-load JS |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Landing `/` | 63 | 1.34 s | 3.84 s | 0 | **1,288 ms** | 5.13 s | 169 kB | 644 kB | 517 kB |
| `/home` | 85 | 1.11 s | 3.75 s | **0.091** | 83 ms | 3.75 s | 200 kB | 373 kB | 571 kB |
| `/money` | 91 | 0.92 s | 3.40 s | 0.043 | 68 ms | 3.45 s | 186 kB | 354 kB | 517 kB |
| `/investments` | 91 | 1.10 s | 3.41 s | 0.023 | 57 ms | 3.47 s | 189 kB | 372 kB | 577 kB |
| `/loans` | 94 | 1.13 s | 3.07 s | 0.032 | 32 ms | 3.13 s | 173 kB | 314 kB | 528 kB |
| `/insurance` | 91 | 1.06 s | 3.40 s | 0.051 | 43 ms | 3.52 s | 175 kB | 322 kB | 537 kB |
| `/taxes` | 90 | 1.07 s | 3.30 s | 0.025 | 59 ms | 3.39 s | 171 kB | 324 kB | 526 kB |
| `/plan` | 91 | 0.96 s | 3.25 s | 0.078 | 50 ms | 3.32 s | 191 kB | 346 kB | 526 kB |

Server work per warm page (family sample person, local database):

| Page | Full HTML | SQL statements |
| --- | --- | --- |
| `/home` | 2,916 ms | **559** |
| `/taxes` | 978 ms | 202 |
| `/plan` | 1,276 ms | 176 |
| `/insurance` | 313 ms | 179 |
| `/ahead` | 473 ms | 82 |
| `/loans` | 286 ms | 48 |
| `/money`, `/investments` | 123 and 269 ms | 36 |

## What the baseline says

1. **The landing page blocks the main thread for 1.3 s.** One 1.2 s task in the column art:
   it fetches a 318 kB PNG, reads its pixels, and sets one `<pre>` of about 500,000 characters
   (a 335 x 1511 drawing at 3 px type), which the browser has to lay out in full. The LCP element
   is that `<pre>`, so the headline waits behind it. (src/components/column-art.tsx)
2. **Signed-in pages are limited by server data, not by scripts.** The shell is fast (TTFB 21 to
   84 ms, FCP about 1 s) but the content arrives after the page's queries: LCP is the first
   content paint (the sample-data note or the net-worth figure), 2 to 2.5 s after FCP.
   `/home` issues 559 statements per render (94 reads of `accounts`, 83 of `transactions`, 82 of
   `plaid_items`, 42 of `liabilities`): the six area trees behind the "What Jane does" tiles each
   run their own page's loaders and each reads the same base tables again.
3. **Layout shift is the footer.** On every signed-in page the largest shift is the site footer
   dropping from the bottom of the screen when the streamed content pushes it down (0.078 of
   `/home`'s 0.091, and all of `/money`'s 0.043).
4. **First-load JavaScript is modest** (517 to 577 kB uncompressed, 170 to 200 kB gzip) and the
   same on every page: Next's shared chunks, the side chat, the card dock and the header. No page
   has a big chart library; the charts are small inline SVG.

## Budget

`src/config/perf-budget.json` holds the first-load JS ceiling of the main pages (the baseline plus
about 5 percent). `npm run check:perf-budget` runs after the CI build and fails when a page is
over. Lower a number when a page gets lighter; raise one only with a reason in the pull request.

## After

(Filled in per pull request: what changed, and the same table row before and after.)
