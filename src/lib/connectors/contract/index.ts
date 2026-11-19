import { dwollaContract } from "./dwolla";
import { guardedFetch } from "./guard";
import { methodContract } from "./method";
import {
  alpacaContract,
  chartContract,
  pinwheelContract,
  postgridContract,
  signwellContract,
} from "./others";
import { formatContract, type ContractResult } from "./shape";
import { snaptradeContract } from "./snaptrade";

// `npm run connectors:contract`: each keyed connector's own read calls against its vendor's test host,
// the real answers through its own parse and normalise, and the fields it expected and didn't get. Local
// only: refused under CI. Every request goes through the test-host guard.

export class NotLocal extends Error {}

export async function runContracts(
  env: Record<string, string | undefined>,
  send: typeof fetch = fetch,
): Promise<ContractResult[]> {
  if (env.CI) throw new NotLocal("The contract run is local only, never in CI.");
  const guarded = guardedFetch(send);
  const results: ContractResult[] = [];
  for (const run of [
    methodContract,
    dwollaContract,
    snaptradeContract,
    postgridContract,
    pinwheelContract,
    alpacaContract,
    signwellContract,
    chartContract,
  ]) {
    try {
      results.push(await run(env, guarded));
    } catch (error) {
      // Its name only: an error from a vendor can carry what it sent.
      results.push({
        connector: run.name.replace(/Contract$/, ""),
        reachable: null,
        parsed: false,
        created: [],
        mismatches: [],
        note: `stopped: ${(error as Error).name}`,
      });
    }
  }
  return results;
}

export { formatContract };
