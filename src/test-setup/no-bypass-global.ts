import { SUITE_RUNS_WITHOUT_BYPASS } from "@/config/deny-by-default";
import { ensureAppLogin } from "./no-bypass-role";

// Run once before a test run. When the suite runs without a bypass (src/config/deny-by-default.ts,
// or TEST_NO_BYPASS=1), points the tests at the jane_app login, which can't touch a table itself.
// The owner's URL stays in TEST_OWNER_DATABASE_URL, for the tests' own rows (no-bypass-client.ts).
export default async function setup() {
  const ownerUrl = process.env.TEST_DATABASE_URL;
  const on = process.env.TEST_NO_BYPASS
    ? process.env.TEST_NO_BYPASS === "1"
    : SUITE_RUNS_WITHOUT_BYPASS;
  if (!on || !ownerUrl) return;
  process.env.TEST_NO_BYPASS = "1";
  const appUrl = await ensureAppLogin(ownerUrl);
  process.env.TEST_OWNER_DATABASE_URL = ownerUrl;
  process.env.TEST_DATABASE_URL = appUrl;
  if (process.env.DATABASE_URL === ownerUrl) process.env.DATABASE_URL = appUrl;
}
