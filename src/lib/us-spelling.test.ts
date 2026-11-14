import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

// Debugger 11-14: Taxes said "Kept organised all year" and the rebalance page "the sales realise
// about", where the rest of Jane is in US spelling ("organizer", "Organizing"). Words on a page are
// spelled one way. Ids, anchors and comments may keep theirs (/taxes#organised is a link).

const SRC = join(__dirname, "..");
const BRITISH =
  /(?<![="#\w-])\b(organised|organise|realise|realised|colour|centre|favourite|behaviour)\b/i;

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return files(path);
    return /\.tsx$/.test(name) && !/\.test\.tsx$/.test(name) ? [path] : [];
  });
}

describe("words on a page", () => {
  it("are in US spelling", () => {
    const bad = [join(SRC, "app"), join(SRC, "components")].flatMap(files).flatMap((file) =>
      readFileSync(file, "utf8")
        .split("\n")
        .flatMap((line, i) =>
          !line.trim().startsWith("//") && BRITISH.test(line)
            ? [`${relative(SRC, file)}:${i + 1}`]
            : [],
        ),
    );
    expect(bad).toEqual([]);
  });
});
