import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

// Debugger 11-15: Settings → Where you're signed in read "Signed in 2026-11-15" at 7pm on the 14th in
// Los Angeles (#1810), the money calendar "On since 2026-11-15", and a do-it-yourself step "You
// marked this done on" the next day: a moment cut to UTC's day. Fields named …At are moments (…On
// and date fields are calendar days, and stay as they are); on the person's pages a moment's day
// is theirs (momentLabel, or localDate with their timezone), never toISOString().slice(0, 10).

const SRC = join(__dirname, "..");

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return files(path);
    return /\.tsx$/.test(name) && !/\.test\.tsx$/.test(name) ? [path] : [];
  });
}

describe("a moment's day on a page", () => {
  it("is the person's own, never UTC's", () => {
    const bad = [join(SRC, "app"), join(SRC, "components")]
      .flatMap(files)
      .map((file) => relative(SRC, file))
      .filter((file) => !file.includes("/admin/"))
      .flatMap((file) =>
        readFileSync(join(SRC, file), "utf8")
          .split("\n")
          .flatMap((line, i) =>
            /At\??\.toISOString\(\)\.slice\(0, 10\)/.test(line) ? [`${file}:${i + 1}`] : [],
          ),
      );
    expect(bad).toEqual([]);
  });
});
