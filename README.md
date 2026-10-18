# Financial Controller MVP

Finds money users are losing and turns each finding into a yes/no decision card. See
[docs/spec.md](docs/spec.md) for the full spec and [CLAUDE.md](CLAUDE.md) for the rules.

## Setup

1. Use Node from `.nvmrc` (`nvm use`).
2. `cp .env.example .env` and fill in `DATABASE_URL`, `DIRECT_URL` and `AUTH_SECRET`. Without
   `RESEND_API_KEY`, magic links print to the dev server console; without the Google keys,
   the Google button is hidden.
3. `npm install` (also generates the Prisma client).
4. `npx prisma migrate dev` to apply migrations.
5. `npx playwright install chromium` once, for end-to-end tests.
6. Optional: export `TEST_DATABASE_URL` pointing at a scratch database and run
   `DIRECT_URL=$TEST_DATABASE_URL npx prisma migrate deploy` so `npm test` also runs the
   cross-user access test against real Postgres (CI always does).

To make someone an admin, set their role in the database:
`UPDATE users SET role = 'admin' WHERE email = 'you@example.com';`

## Commands

| Command             | What it does                    |
| ------------------- | ------------------------------- |
| `npm run dev`       | Start the app on localhost:3000 |
| `npm test`          | Unit tests (Vitest)             |
| `npm run test:e2e`  | End-to-end tests (Playwright)   |
| `npm run lint`      | ESLint                          |
| `npm run typecheck` | TypeScript check                |
| `npm run format`    | Format with Prettier            |
