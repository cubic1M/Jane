# Migrations

A production build runs `prisma migrate deploy` first (`vercel-build`), so a migration lands while
the old code is still serving, and it stays if the build then fails or the deploy is rolled back.
Every migration must work with the code that's running now.

## Expand, then contract

Never change a shape in one step. To rename `users.nick` to `users.nickname`:

1. **Expand.** Add `nickname` (nullable, or with a default). The code writes both and reads either.
2. **Move.** Backfill old rows. The code uses only `nickname`.
3. **Remove from the schema.** Take `nick` out of `schema.prisma` and the code, with no migration,
   because Prisma selects every field it knows, so the running code would break if the column went
   first. Wait until this is live.
4. **Contract.** Drop `nick` in its own PR, with the review line below.

## The gate

`npm run check:migrations` runs in CI inside the required "Lint, typecheck and unit tests". It fails on:

- **Unsafe SQL** in a new migration: dropping or renaming a table, column or type, dropping a
  constraint, default or NOT NULL, changing a column's type, a new required column with no default,
  SET NOT NULL, TRUNCATE, or DELETE FROM. It uses [Squawk](https://squawk.dev) plus
  `scripts/migration-gate-core.mjs`.
- **Editing or removing** a migration already on main. No mark lifts this.
- **Order.** A new name must sort after every name on main.
- **`prisma/migrations-head.txt`** not holding the newest name. Two PRs that add migrations conflict
  on that line, so the second has to rebase and is checked against the first.

A reviewed contract step carries this line in its SQL, naming the PR that is already live and stopped
using the old shape. The gate checks that the line is there, and a person checks that it's true:

```sql
-- reviewed-contract-step: users.nick, unused since #1300
```

## Names

Names are sort keys, not dates: about 160 of them sort after today because each new one had to go
after the last. `prisma migrate dev` stamps today's date, so rename its folder to sort last (the
gate's message gives a name) and put that name in `prisma/migrations-head.txt`. Never rename one
that's on main: Prisma would apply it again.

## How the old names were checked (2026-11-03)

55 of the first 214 migrations landed on main after one that sorts later (247 pairs), so a fresh
database and production ran them in different orders. Prisma doesn't skip such a migration: `migrate
deploy` applies everything not yet recorded, by name, which a scratch database confirmed. Applying
all 214 in merge order and in name order gave the same columns, constraints, indexes, enums and
functions, and the same rows apart from the merchants' created-at times. No inverted pair touches the
same table, except for references to `users`. Production's own migrations table wasn't read.
