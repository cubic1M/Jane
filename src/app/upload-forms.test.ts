import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { documentTooBig, MAX_DOCUMENT_BYTES } from "@/config/documents";
import { MAX_UPLOAD_BYTES } from "@/config/import";

// A file past the 5 MB a request takes never reaches the server's own check: the page crashes to
// "Something went wrong" (round 4 on /import; debugger 11-03 on /documents, with a 5 MB scan, which
// is an ordinary phone photo). So every form with a file input says so in the browser first.
const APP = "src/app";

function formsWithFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return formsWithFiles(path);
    if (!name.endsWith(".tsx") || name.includes(".test.")) return [];
    return readFileSync(path, "utf8").includes('type="file"') ? [path] : [];
  });
}

describe("every form that takes a file", () => {
  const forms = formsWithFiles(APP);

  it("finds the forms", () => {
    expect(forms.length).toBeGreaterThanOrEqual(3);
  });

  it.each(forms)("%s checks the size before sending", (path) => {
    const source = readFileSync(path, "utf8");
    expect(source).toMatch(/\.size\b/);
    expect(source).toMatch(/MAX_(UPLOAD|DOCUMENT)_BYTES/);
  });

  it("keeps its limit under what one request takes", () => {
    const requestBytes = 5 * 1024 * 1024;
    expect(MAX_DOCUMENT_BYTES).toBeLessThan(requestBytes);
    expect(MAX_UPLOAD_BYTES).toBeLessThan(requestBytes);
  });

  it("says the limit in words", () => {
    expect(documentTooBig()).toContain("4 MB");
  });
});
