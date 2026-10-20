import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  resolve: { tsconfigPaths: true },
  test: {
    environment: "node",
    include: ["src/**/*.test.{ts,tsx}"],
    restoreMocks: true,
    // The database tests run Jane over a whole demo bank and share CI with hundreds of others;
    // the 5 s default timed out on the heavier ones whenever the suite ran in parallel.
    testTimeout: 30_000,
  },
});
