import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { RlsClient } from "./rls-pg";

// RlsClient sends a connection's statements one at a time, each once the one before has settled
// (src/lib/rls-pg.ts). So one that never settled would hold up every statement behind it on that
// connection. Each way a statement can end short (a statement timeout, an error, the connection
// killed mid-chain) must settle it and everything waiting behind it, as pg's own queue did.

const url = process.env.TEST_DATABASE_URL;
const q = (text: string) => ({ text, values: [] });
const HUNG = Symbol("hung");
// Each statement's outcome, or HUNG if it hasn't settled within `ms`.
const settled = (calls: Promise<unknown>[], ms: number) =>
  Promise.race([
    Promise.allSettled(calls).then((r) => r.map((s) => s.status)),
    new Promise<typeof HUNG>((resolve) => setTimeout(() => resolve(HUNG), ms)),
  ]);

describe.runIf(url)("a chain of statements on one app connection", () => {
  let owner: pg.Client;
  const open: RlsClient[] = [];
  const connected = async () => {
    const client = new RlsClient({ connectionString: url! } as never);
    client.on("error", () => undefined);
    await client.connect();
    open.push(client);
    return client;
  };

  beforeAll(async () => {
    owner = new pg.Client({ connectionString: url! });
    await owner.connect();
  });

  afterAll(async () => {
    await Promise.all(open.map((c) => c.end().catch(() => undefined)));
    await owner.end();
  });

  it("goes on past a statement the server times out", async () => {
    const client = await connected();
    await client.query(q("SET statement_timeout = 200"));
    const calls = [client.query(q("SELECT pg_sleep(5)")), client.query(q("SELECT 1 AS one"))];
    expect(await settled(calls, 3_000)).toEqual(["rejected", "fulfilled"]);
    await expect(calls[0]).rejects.toThrow(/statement timeout/);
  });

  it("goes on past a statement that fails, and the failure still reaches its caller", async () => {
    const client = await connected();
    const calls = [client.query(q("SELECT no_such_column")), client.query(q("SELECT 1 AS one"))];
    expect(await settled(calls, 3_000)).toEqual(["rejected", "fulfilled"]);
    await expect(calls[0]).rejects.toThrow(/no_such_column/);
  });

  it("settles every statement waiting behind one whose connection is killed", async () => {
    const client = await connected();
    const pid = ((await client.query(q("SELECT pg_backend_pid() AS pid"))) as pg.QueryResult)
      .rows[0].pid as number;
    const calls = [
      client.query(q("SELECT pg_sleep(30)")),
      client.query(q("SELECT 1 AS one")),
      client.query(q("SELECT 2 AS two")),
    ];
    await new Promise((resolve) => setTimeout(resolve, 200));
    await owner.query("SELECT pg_terminate_backend($1)", [pid]);
    expect(await settled(calls, 5_000)).toEqual(["rejected", "rejected", "rejected"]);
  });
});
