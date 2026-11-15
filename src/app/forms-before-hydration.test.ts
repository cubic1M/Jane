import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Debugger 11-15: on a slow phone, a form that only has a script's onSubmit is a plain form until
// the page's script runs. Tapping its button then sends the fields in the address: /import?
// accountId=new&new.name=&new.kind=checking&new.balance=&files=stmt.csv, an account's name and
// balance in the browser's history and the server's request logs. Every such form says
// method="post": sent too early, the page loads again and nothing is in the address.

const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return walk(path);
    return path.endsWith(".tsx") && !path.includes(".test.") ? [path] : [];
  });

// Each <form …> opening tag's attributes, with the braces of its props skipped.
function formTags(source: string): { line: number; tag: string }[] {
  const tags: { line: number; tag: string }[] = [];
  let at = 0;
  while ((at = source.indexOf("<form", at)) >= 0) {
    if (!/[\s>]/.test(source[at + 5] ?? "")) {
      at += 5;
      continue;
    }
    let depth = 0;
    let end = at + 5;
    for (; end < source.length; end++) {
      const c = source[end];
      if (c === "{") depth++;
      else if (c === "}") depth--;
      else if (c === ">" && depth === 0) break;
    }
    tags.push({ line: source.slice(0, at).split("\n").length, tag: source.slice(at, end) });
    at = end;
  }
  return tags;
}

describe("a form a script sends", () => {
  it("posts, so a tap before the script runs puts nothing in the address", () => {
    const off = walk(join(__dirname, "..")).flatMap((file) =>
      formTags(readFileSync(file, "utf8"))
        .filter(({ tag }) => /\bonSubmit=/.test(tag) && !/\baction=/.test(tag))
        .filter(({ tag }) => !/\bmethod="post"/.test(tag))
        .map(({ line }) => `${file.slice(file.indexOf("src/"))}:${line}`),
    );
    expect(off).toEqual([]);
  });
});
