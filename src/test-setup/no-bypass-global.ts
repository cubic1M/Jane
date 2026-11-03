import { ensureAppLogin } from "./no-bypass-role";

// Run once before a test run. With TEST_NO_BYPASS=1, points the tests at the jane_app login, which
// can't touch a table itself. The owner's URL stays in TEST_OWNER_DATABASE_URL, for the tests' own
// rows (no-bypass-client.ts).
export default async function setup() {
  const ownerUrl = process.env.TEST_DATABASE_URL;
  if (process.env.TEST_NO_BYPASS !== "1" || !ownerUrl) return;
  const appUrl = await ensureAppLogin(ownerUrl);
  process.env.TEST_OWNER_DATABASE_URL = ownerUrl;
  process.env.TEST_DATABASE_URL = appUrl;
  if (process.env.DATABASE_URL === ownerUrl) process.env.DATABASE_URL = appUrl;
}
