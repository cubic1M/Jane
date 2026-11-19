# Keys in a worktree

The test keys for the connectors (Method, SnapTrade, Dwolla, Pinwheel, PostGrid, Retell and the rest) live
in the main checkout's local `.env` (`/Users/andrewli/Desktop/Jane/.env`), which only the founder edits.
A worktree under `.claude/worktrees/` doesn't see it. To give a worktree's dev server the keys:

```bash
node scripts/worktree-keys.mjs
```

It links the worktree's `.env` to the main checkout's (a symlink, never a copy), only where git ignores
`.env`, and never reads or prints a value. Next.js then loads it beneath the worktree's own `.env.local`,
which wins for any name both have. Restart the dev server afterwards. It leaves a worktree's own `.env`
alone, and `--unlink` removes the link.

Then `npm run connectors:check` says which names are set and whether each vendor's test environment
accepts them, by name and yes or no only.

Sessions never open, print or copy the file (a tool hook blocks reading `.env` files).
