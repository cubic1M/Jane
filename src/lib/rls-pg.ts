import pg from "pg";
import { AS_USER_READ_SQL, AS_USER_SQL, AS_USER_WRITE_SQL } from "@/lib/rls";

// The fast path for a scoped read (src/lib/rls.ts, docs/security/rls.md). Prisma runs it as
// four statements, each a network round trip to the database: BEGIN, the switch to the person,
// the query, COMMIT. This connection class sends the switch and each statement together, one
// round trip, as one implicit transaction: Postgres runs every statement written before the next
// Sync in one transaction, so the switch ends with the statement, exactly as it would at COMMIT.
// BEGIN and COMMIT, then, have nothing left to do and are answered here. A write keeps Prisma's
// whole transaction, so a nested write stays all-or-nothing: BEGIN and the switch go with its
// first statement, and the rest, COMMIT included, as Prisma writes them.
//
// It changes only how statements travel, never what runs: with a plain pg client (tests, other
// tools) the same four statements go one by one and mean the same thing.

type Config = { text: string; values?: unknown[]; [key: string]: unknown };
type Result = { rowCount: number | null; rows: unknown[]; fields: unknown[]; command: string };
type Connection = {
  parse(msg: { text: string; name: string; types: unknown[] }): void;
  bind(msg: { portal: string; statement: string; values: unknown[] }): void;
  execute(msg: { portal: string }): void;
};

// pg's own query, with statements written before it and its Sync: BEGIN (for a write), the
// switch, then the query. Only the query's rows and outcome are kept; an error in any fails it.
const BaseQuery = pg.Query as unknown as new (config: object) => {
  prepare(connection: Connection): void;
  handleDataRow(msg: unknown): void;
  handleCommandComplete(msg: unknown, connection: Connection): void;
};

class AsUserQuery extends BaseQuery {
  // Statements before the query whose answers are skipped.
  private before: number;

  constructor(
    private readonly userId: string,
    private readonly begin: boolean,
    config: object,
  ) {
    super(config);
    this.before = begin ? 2 : 1;
  }

  requiresPreparation() {
    return true;
  }

  prepare(connection: Connection) {
    if (this.begin) {
      connection.parse({ text: "BEGIN", name: "", types: [] });
      connection.bind({ portal: "", statement: "", values: [] });
      connection.execute({ portal: "" });
    }
    connection.parse({ text: AS_USER_SQL, name: "", types: [] });
    connection.bind({ portal: "", statement: "", values: [this.userId] });
    connection.execute({ portal: "" });
    super.prepare(connection);
  }

  handleDataRow(msg: unknown) {
    if (this.before === 0) super.handleDataRow(msg);
  }

  handleCommandComplete(msg: unknown, connection: Connection) {
    if (this.before > 0) this.before -= 1;
    else super.handleCommandComplete(msg, connection);
  }
}

const done = (command: string, rowCount: number | null = null): Promise<Result> =>
  Promise.resolve({ rowCount, rows: [], fields: [], command });

// Where a pooled connection is in a transaction Prisma opened.
type State =
  | { step: "idle" }
  | { step: "begun" } // BEGIN held back until we know what follows
  | { step: "reading"; userId: string } // a scoped read: each statement goes switched
  | { step: "writing"; userId: string }; // a scoped write: BEGIN and the switch go with the next

export class RlsClient extends pg.Client {
  private state: State = { step: "idle" };

  // Prisma's driver calls query(config) and awaits the promise; every other form (the pool's
  // own calls, callbacks) goes straight through.
  query(...args: unknown[]): never {
    const [config, values, callback] = args;
    const plain =
      args.length === 1 &&
      typeof config === "object" &&
      config !== null &&
      typeof (config as Config).text === "string" &&
      typeof (config as { submit?: unknown }).submit !== "function";
    if (!plain) return (super.query as (...a: unknown[]) => never)(config, values, callback);
    return this.next(config as Config) as never;
  }

  private send(config: Config | string): Promise<Result> {
    return (super.query as (c: Config | string) => Promise<Result>)(config);
  }

  private sendAsUser(userId: string, begin: boolean, config: Config): Promise<Result> {
    return new Promise((resolve, reject) => {
      const query = new AsUserQuery(userId, begin, {
        ...config,
        callback: (error: Error | null, result: Result) =>
          error ? reject(error) : resolve(result),
      });
      (super.query as (q: unknown) => unknown)(query);
    });
  }

  private next(config: Config): Promise<Result> {
    const text = config.text.trim();
    const state = this.state;
    const ends = text === "COMMIT" || text === "ROLLBACK";
    switch (state.step) {
      case "idle":
        if (text === "BEGIN") {
          this.state = { step: "begun" };
          return done("BEGIN");
        }
        return this.send(config);
      case "begun":
        if (text === AS_USER_READ_SQL) {
          this.state = { step: "reading", userId: String(config.values?.[0] ?? "") };
          return done("SELECT", 1);
        }
        if (text === AS_USER_WRITE_SQL) {
          this.state = { step: "writing", userId: String(config.values?.[0] ?? "") };
          return done("SELECT", 1);
        }
        if (ends) {
          this.state = { step: "idle" };
          return done(text);
        }
        // Any other transaction: BEGIN goes first, as Prisma wrote it.
        this.state = { step: "idle" };
        return this.send("BEGIN").then(() => this.send(config));
      case "reading":
        if (ends) {
          this.state = { step: "idle" };
          return done(text);
        }
        // A read may take more than one statement (a relation loaded on its own): each is
        // switched to the person in its own round trip, as reads were never one transaction.
        return this.sendAsUser(state.userId, false, config);
      case "writing":
        this.state = { step: "idle" };
        if (ends) return done(text);
        // Then the transaction is open, switched, and the rest goes as written.
        return this.sendAsUser(state.userId, true, config);
    }
  }
}

// The app's connection pool: pg's own, with the fast path.
export function rlsPool(
  connectionString: string | undefined,
  options: pg.PoolConfig = {},
): pg.Pool {
  return new pg.Pool({
    ...options,
    connectionString,
    Client: RlsClient as unknown as new () => pg.ClientBase,
  });
}
