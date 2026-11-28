import pg from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { memoRead, withRequestMemo } from "@/lib/read-memo";
import { RlsClient } from "./rls-pg";

// A request shares what it reads (src/lib/read-memo.ts), so a read after a write must not be handed
// the value from before it, whoever wrote. The app's connections are RlsClient (src/lib/rls-pg.ts),
// the one door every statement of the app goes through, so a write statement through it forgets
// what the request shared, whether the scoped helper, a client of its own or a raw statement sent
// it. (Tests go to the database's owner for their own writes, so this asks the connection itself.)

const url = process.env.TEST_DATABASE_URL;
const q = (text: string) => ({ text, values: [] });

describe.runIf(url)("what a request shared is forgotten by a write on the app's connection", () => {
  let client: RlsClient;

  beforeAll(async () => {
    client = new RlsClient({ connectionString: url! } as never);
    client.on("error", () => undefined);
    await client.connect();
    await client.query(q("CREATE TEMP TABLE shared_probe (x int)"));
  });
  afterAll(async () => {
    await client.end();
  });

  // The same question asked again after `statement` has been sent: how many times it was really asked.
  async function asked(statement: string) {
    const read = vi.fn(async () => "rows");
    return withRequestMemo(async () => {
      await memoRead("probe", read);
      await memoRead("probe", read);
      expect(read).toHaveBeenCalledTimes(1);
      await client.query(q(statement));
      await memoRead("probe", read);
      return read.mock.calls.length;
    });
  }

  it("shares a read, and a read statement leaves it alone", async () => {
    expect(await asked("SELECT * FROM shared_probe")).toBe(1);
  });

  it.each([
    "INSERT INTO shared_probe VALUES (1)",
    "UPDATE shared_probe SET x = 2",
    "/* route='/api/x' */ INSERT INTO shared_probe VALUES (3)",
    "-- a job\n  DELETE FROM shared_probe",
    "WITH moved AS (DELETE FROM shared_probe RETURNING x) SELECT count(*) FROM moved",
  ])("forgets it when this is sent: %s", async (statement) => {
    expect(await asked(statement)).toBe(2);
  });

  it("forgets it when the write fails too", async () => {
    const read = vi.fn(async () => "rows");
    await withRequestMemo(async () => {
      await memoRead("probe", read);
      await expect(client.query(q("INSERT INTO no_such_table VALUES (1)"))).rejects.toThrow();
      await memoRead("probe", read);
    });
    expect(read).toHaveBeenCalledTimes(2);
  });

  it("is the same on a connection of the pool", async () => {
    const pool = new pg.Pool({ connectionString: url!, Client: RlsClient as never });
    const mine = await pool.connect();
    try {
      await mine.query(q("CREATE TEMP TABLE shared_probe2 (x int)"));
      const read = vi.fn(async () => "rows");
      await withRequestMemo(async () => {
        await memoRead("probe", read);
        await mine.query(q("INSERT INTO shared_probe2 VALUES (1)"));
        await memoRead("probe", read);
      });
      expect(read).toHaveBeenCalledTimes(2);
    } finally {
      mine.release();
      await pool.end();
    }
  });
});
