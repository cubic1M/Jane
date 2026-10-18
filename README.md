# Financial Controller MVP

Finds money users are losing and turns each finding into a yes/no decision card. See
[docs/spec.md](docs/spec.md) for the full spec and [CLAUDE.md](CLAUDE.md) for the rules.

## Setup

1. Use Node from `.nvmrc` (`nvm use`).
2. `cp .env.example .env` and fill in `DATABASE_URL` and `DIRECT_URL`.
3. `npm install` (also generates the Prisma client).
4. `npx prisma migrate dev` to apply migrations.
5. `npx playwright install chromium` once, for end-to-end tests.

## Commands

| Command             | What it does                    |
| ------------------- | ------------------------------- |
| `npm run dev`       | Start the app on localhost:3000 |
| `npm test`          | Unit tests (Vitest)             |
| `npm run test:e2e`  | End-to-end tests (Playwright)   |
| `npm run lint`      | ESLint                          |
| `npm run typecheck` | TypeScript check                |
| `npm run format`    | Format with Prettier            |
