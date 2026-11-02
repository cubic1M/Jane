// Run before pushing: npm run check:e2e-wording. Lists wording removed from src/ (against
// origin/main, or the ref given) that an end-to-end spec still expects, and exits 1 if there is any.
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { staleWording } from "./e2e-wording-core.mjs";

const base = process.argv[2] ?? "origin/main";
const mergeBase = execFileSync("git", ["merge-base", base, "HEAD"], { encoding: "utf8" }).trim();
const diff = execFileSync("git", ["diff", "--unified=0", mergeBase, "--", "src"], {
  encoding: "utf8",
  maxBuffer: 64 * 1024 * 1024,
});
const specs = readdirSync("e2e", { recursive: true })
  .filter((f) => String(f).endsWith(".ts"))
  .map((f) => ({
    file: join("e2e", String(f)),
    text: readFileSync(join("e2e", String(f)), "utf8"),
  }));
const hits = staleWording(diff, specs);
for (const { file, line, wording } of hits) console.log(`${file}:${line}  still says "${wording}"`);
if (hits.length > 0) {
  console.log(`\n${hits.length} place(s) in e2e/ still expect wording removed from src/.`);
  process.exit(1);
}
console.log("No end-to-end spec expects wording removed from src/.");
