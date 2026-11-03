import pg from "pg";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  AS_SYSTEM_READ_SQL,
  AS_SYSTEM_SQL,
  AS_SYSTEM_WRITE_SQL,
  AS_USER_READ_SQL,
  AS_USER_SQL,
  AS_USER_WRITE_SQL,
} from "./rls";
import { RlsClient } from "./rls-pg";

// What the app's pool sends for each statement Prisma writes, with the database stubbed out:
// each statement of a scoped read goes as one pipelined query; everything else as written.

const result = { rowCount: 0, rows: [], fields: [], command: "SELECT" };
let sent: unknown[];

beforeEach(() => {
  sent = [];
  vi.spyOn(pg.Client.prototype, "query").mockImplementation(((config: unknown) => {
    sent.push(config);
    // A submitted query object reports through its callback; anything else gets a promise.
    const submitted = config as { submit?: unknown; callback?: (e: null, r: unknown) => void };
    if (typeof submitted.submit === "function") submitted.callback?.(null, result);
    return Promise.resolve(result);
  }) as never);
});

const q = (text: string, values: unknown[] = []) => ({ text, values, rowMode: "array" });
const texts = () =>
  sent.map((s) =>
    typeof s === "string"
      ? s
      : typeof (s as { submit?: unknown }).submit === "function"
        ? `[${(s as { begin: boolean }).begin ? "begin, " : ""}as user] ${(s as { text: string }).text}`
        : (s as { text: string }).text,
  );

describe("RlsClient", () => {
  it("sends a scoped read as one query, switched to the person", async () => {
    const client = new RlsClient();
    await client.query(q("BEGIN"));
    await client.query(q(AS_USER_READ_SQL, ["user_1"]));
    await client.query(q("SELECT * FROM budgets WHERE user_id = $1", ["user_1"]));
    await client.query(q("COMMIT"));

    expect(texts()).toEqual(["[as user] SELECT * FROM budgets WHERE user_id = $1"]);
    expect((sent[0] as { to: { values: unknown[] } }).to.values).toEqual(["user_1"]);
  });

  it("sends a system read as one query, switched to jane_system", async () => {
    const client = new RlsClient();
    await client.query(q("BEGIN"));
    await client.query(q(AS_SYSTEM_READ_SQL));
    await client.query(q("SELECT * FROM jobs"));
    await client.query(q("COMMIT"));

    expect(texts()).toEqual(["[as user] SELECT * FROM jobs"]);
    expect((sent[0] as { to: { sql: string; values: unknown[] } }).to).toEqual({
      sql: AS_SYSTEM_SQL,
      values: [],
    });
  });

  it("sends a system write with BEGIN and the switch, then the rest as written", async () => {
    const client = new RlsClient();
    await client.query(q("BEGIN"));
    await client.query(q(AS_SYSTEM_WRITE_SQL));
    await client.query(q("UPDATE jobs SET status = $1", ["done"]));
    await client.query(q("COMMIT"));

    expect(texts()).toEqual(["[begin, as user] UPDATE jobs SET status = $1", "COMMIT"]);
  });

  it("sends every other transaction as written, BEGIN first", async () => {
    const client = new RlsClient();
    for (const text of ["BEGIN", AS_USER_SQL, "SELECT 1", "COMMIT"]) await client.query(q(text));
    for (const text of ["BEGIN", "SET TRANSACTION ISOLATION LEVEL SERIALIZABLE", "SELECT 2"])
      await client.query(q(text));
    await client.query(q("ROLLBACK"));

    expect(texts()).toEqual([
      "BEGIN",
      AS_USER_SQL,
      "SELECT 1",
      "COMMIT",
      "BEGIN",
      "SET TRANSACTION ISOLATION LEVEL SERIALIZABLE",
      "SELECT 2",
      "ROLLBACK",
    ]);
  });

  it("switches each statement of a read, so nothing in it runs as the app's role", async () => {
    const client = new RlsClient();
    await client.query(q("BEGIN"));
    await client.query(q(AS_USER_READ_SQL, ["user_1"]));
    await client.query(q("SELECT 1"));
    await client.query(q("SELECT 2"));
    await client.query(q("COMMIT"));
    await client.query(q("SELECT 3"));

    expect(texts()).toEqual(["[as user] SELECT 1", "[as user] SELECT 2", "SELECT 3"]);
  });

  it("sends a scoped write's BEGIN and switch with its first statement, the rest as written", async () => {
    const client = new RlsClient();
    await client.query(q("BEGIN"));
    await client.query(q(AS_USER_WRITE_SQL, ["user_1"]));
    await client.query(q("INSERT INTO budgets VALUES (1)"));
    await client.query(q("INSERT INTO budget_tune_ups VALUES (1)"));
    await client.query(q("COMMIT"));

    expect(texts()).toEqual([
      "[begin, as user] INSERT INTO budgets VALUES (1)",
      "INSERT INTO budget_tune_ups VALUES (1)",
      "COMMIT",
    ]);
  });

  it("answers an empty transaction without sending anything", async () => {
    const client = new RlsClient();
    await client.query(q("BEGIN"));
    await client.query(q("COMMIT"));

    expect(sent).toEqual([]);
  });

  it("passes the pool's own calls straight through", () => {
    const client = new RlsClient();
    const callback = vi.fn();
    client.query("SELECT 1", [], callback);

    expect(sent).toEqual(["SELECT 1"]);
  });
});
