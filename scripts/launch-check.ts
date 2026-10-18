// Production switch checklist: `npm run check:launch` with the production environment
// loaded. Exits 1 if anything required fails. Prints pass/fail only, never values.
import { launchChecks, launchReady } from "../src/lib/launch-check.ts";

const checks = launchChecks(process.env);
for (const c of checks) {
  const mark = c.ok ? "PASS" : c.required ? "FAIL" : "WARN";
  console.log(`${mark}  ${c.name}: ${c.detail}`);
}
const ready = launchReady(checks);
console.log(ready ? "\nReady for production." : "\nNot ready: fix the FAIL lines first.");
process.exit(ready ? 0 : 1);
