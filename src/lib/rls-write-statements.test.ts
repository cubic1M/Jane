import { describe, expect, it } from "vitest";
import { isWriteStatement } from "./rls-pg";

// A write forgets what the render or request shared (src/lib/read-memo.ts), whoever sent it and
// however the statement starts.
describe("which statements write", () => {
  it("knows a write by its first word, after any comments in front of it", () => {
    for (const text of [
      'INSERT INTO "a" VALUES ($1)',
      '  update "a" set x = 1',
      "DELETE FROM a",
      "/* route='/home' */ UPDATE a SET x = 1",
      "-- sent by a job\n  INSERT INTO a VALUES (1)",
      "/* one */ /* two */ -- three\nDELETE FROM a",
      "WITH moved AS (DELETE FROM a RETURNING *) SELECT * FROM moved",
    ])
      expect(isWriteStatement(text), text).toBe(true);
  });

  it("leaves reads alone, comments or not", () => {
    for (const text of [
      'SELECT "id" FROM "a"',
      "/* update the page */ SELECT 1",
      "-- delete nothing\nSELECT 1",
      "BEGIN",
      "COMMIT",
      "WITH x AS (SELECT 1) SELECT * FROM x",
    ])
      expect(isWriteStatement(text), text).toBe(false);
  });
});
