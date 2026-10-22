import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  resolve: { tsconfigPaths: true },
  test: {
    environment: "node",
    include: ["src/**/*.test.{ts,tsx}"],
    restoreMocks: true,
    // Spec step 293: no test calls Anthropic; a request to its API fails the test.
    setupFiles: ["src/test-setup/no-anthropic.ts"],
    // The integration tests run against a real database on shared CI runners; with dozens of
    // pull requests running at once, tests that finish in a second or two locally pass 5
    // seconds. A test that hangs still fails, just later.
    testTimeout: 20_000,
    // Setup hooks that link and sync a demo bank (about 100 integration files) hit the default
    // 10s on a busy runner and fail at random, holding up unrelated pull requests.
    hookTimeout: 60_000,
  },
});
