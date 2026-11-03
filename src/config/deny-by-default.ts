// How the test suite treats deny by default (docs/security/rls.md). Kept here, away from
// src/test-setup, so turning it on doesn't touch the test harness itself.

// Whether the suite runs on the login with no bypass when TEST_DATABASE_URL is set. TEST_NO_BYPASS
// wins over this: "1" on, "0" off.
export const SUITE_RUNS_WITHOUT_BYPASS = false;

// Who makes a test's own rows, and so goes through the database's owner, by the file calling.
export const TEST_CODE = /\.test\.tsx?$|\/src\/test-setup\/|\/src\/security\/access-proof\//;

// The doors: what they send is the switch, then the query, so NO_BYPASS_LOG leaves them out.
export const DOORS = /\/src\/lib\/(db-scoped|system-db|rls|rls-coverage|read-cache)\.ts/;
