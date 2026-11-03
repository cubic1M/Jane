import { describe, expect, it } from "vitest";
import { askImportStatus } from "./chip-status";

const answer = (status: number, body: unknown = {}) =>
  (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;

describe("what the import chip hears", () => {
  it("passes on the run, or that there's none", async () => {
    const run = { id: "r1", stage: "matching" };
    expect(await askImportStatus(answer(200, { run }))).toEqual(run);
    expect(await askImportStatus(answer(200, { run: null }))).toBeNull();
  });

  it("doesn't take a busy server for 'nothing running'", async () => {
    expect(await askImportStatus(answer(429))).toBe("unknown");
    expect(await askImportStatus(answer(503))).toBe("unknown");
  });

  it("doesn't take a dropped connection for 'nothing running'", async () => {
    const dropped = (async () => {
      throw new TypeError("fetch failed");
    }) as unknown as typeof fetch;
    expect(await askImportStatus(dropped)).toBe("unknown");
  });

  it("reads being signed out as no run, so it stops asking", async () => {
    expect(await askImportStatus(answer(401))).toBeNull();
  });
});
