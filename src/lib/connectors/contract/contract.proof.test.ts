import { describe, expect, it } from "vitest";
import { formatContract, runContracts } from "./index";

// The contract run (`npm run connectors:contract`): real calls to vendors' test hosts. Excluded from
// every normal test run (a .proof.test.ts) and skipped unless CONNECTOR_CONTRACT=1, never under CI.
// Prints names and yes or no only.

describe.runIf(process.env.CONNECTOR_CONTRACT === "1" && !process.env.CI)(
  "connector contracts",
  () => {
    it(
      "runs each keyed connector's reads against its test host",
      { timeout: 300_000 },
      async () => {
        const results = await runContracts(process.env);
        process.stdout.write(`\n${results.map(formatContract).join("\n")}\n\n`);
        expect(results.length).toBeGreaterThan(0);
      },
    );
  },
);
