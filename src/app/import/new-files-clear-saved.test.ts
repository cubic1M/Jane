import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Debugger 11-16 (a Chase card, then a Bank of America checking file, on a phone): while the second
// file was previewed, the first upload's "Saved 58 transactions… Saved. Jane is updating your net
// worth. See your report / Go to Home" still sat above "Import 38 transactions". Choosing new files
// starts the next upload, so the last one's result goes. Unit tests here render on the server,
// where events don't fire, so this reads the form.

const form = readFileSync(join(__dirname, "import-form.tsx"), "utf8");

describe("choosing the next files", () => {
  it("clears the last upload's result", () => {
    const input = form.slice(form.indexOf('name="files"'));
    const onChange = input.slice(input.indexOf("onChange={"), input.indexOf("}}") + 2);
    expect(onChange).toMatch(/setSaved\(null\)/);
  });
});
