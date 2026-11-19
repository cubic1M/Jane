// `npm run connectors:check` (docs/connectors.md): each connector's key names, set or missing, and
// whether its vendor's test environment accepts them. Names and yes or no only, never a value.
// `--names` skips the calls. Load the keys first (docs/setup/worktree-keys.md in a worktree).
import { checkConnectorEnv, formatCheck } from "../src/lib/connectors/env-check.ts";

const lines = await checkConnectorEnv(process.env, { reach: !process.argv.includes("--names") });
for (const line of lines) console.log(formatCheck(line));
