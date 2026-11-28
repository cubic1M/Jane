# Fast pages: fewer round trips, 11-28 (founder)

Founder, 11-28: "it is taking way longer to load the chat and suggestions". No code change had made a
page slower: each page asks the database a few hundred small questions, each one a round trip (about
6 ms from Vercel to the database), and reads the person's whole year of transactions several times, so
the time grows with the person's data. This is what changed, how to read it, and what is left.

## What a page shares

1. **The same question twice** has one answer for the length of a render (`src/lib/read-memo.ts`, as
   before). A route is no render, so `withRequestMemo` gives it the same store; the card dock
   (`/api/chat/cards`) uses it. Any write forgets what was shared, and since this change every write
   statement that reaches the database through the app's pool does (`src/lib/rls-pg.ts`), whichever
   client sent it.
2. **Twenty different questions about one small table** are answered from one read of the person's rows
   (`src/lib/row-snapshots.ts`, tables in `src/config/fast-reads.ts`): accounts, tax profile, liabilities,
   suggestions, findings and the like. The year's transactions, balances and investment moves are read
   once from the start of last year for every question about a span inside it, and "the newest" questions
   (the newest day, the newest few rows) are answered from it too when it holds them in full.
3. **The answer is the database's answer.** `src/lib/row-eval.ts` understands only plain shapes (scalar
   filters, scalar order, a scalar select, count and simple aggregates) and follows SQL, not JavaScript:
   a missing value is neither equal nor unequal (three-valued logic), a text search is a LIKE with its
   wildcards, nulls sort last ascending and first descending, text order is left to the database's
   collation. Anything else (a relation, a JSON path, a cursor, distinct, a text order, a secret column)
   goes to the database as it always did. `src/lib/row-eval.integration.test.ts` asks the database and the
   evaluator the same 60 questions on a table with missing values and requires the same rows, order and
   shape.
4. **Outside a render or a request** nothing is shared and nothing changes.

## Reading the numbers

The budget test (`src/lib/jane-agent/dock-queries.integration.test.ts`) counts the queries the dock, the
chat and Home's top make for the demo person and fails above its budget. Add a loader that asks again for
what the page has, and it goes red. Raise a budget only with a reason in the pull request.

## What is left (the query lists)

Reads that name a relation (`account: { select … }`, `item: { … }`, a filter on a related table) are still
one query each, and so are the chat's own messages, documents, deadlines and the questions with no start
day (the oldest transaction, the first day of each account). Teaching the evaluator to follow a to-one
relation between two held tables would take most of the rest of Home's and the chat's reads.

## Not in code

The model key is refused (401), so the chat answers from its own words after one failed call per
function instance and a few minutes (`src/lib/anthropic.ts`); the key itself is the founder's to renew.
Database connections that sit idle are closed after ten seconds and each new one costs 0.15 to 1.5 s; see
the pull request for the evidence and what only the founder can change.
