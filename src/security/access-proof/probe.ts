import net from "node:net";
import pg from "pg";

// What an attack did that the caller can't see: which queries carried the victim's id or read their
// marker, what it wrote to whose rows (triggers on every owned table, so nothing escapes), and any
// attempt to leave the machine.

const url = () => (process.env.TEST_OWNER_DATABASE_URL ?? process.env.TEST_DATABASE_URL)!;

type Sql = <T = Record<string, unknown>>(text: string, params?: unknown[]) => Promise<T[]>;

export type Traffic = {
  landed: boolean;
  markerRead: string[];
  outbound: string[];
};

const traffic: Traffic = { landed: false, markerRead: [], outbound: [] };
let watching: { rowId: string; userId: string; marker: string } | null = null;
let paused = 0;

export function watch(target: { rowId: string; userId: string; marker: string } | null) {
  watching = target;
  traffic.landed = false;
  traffic.markerRead = [];
  traffic.outbound = [];
}

export const seen = () => ({ ...traffic });

type SpiedQuery = {
  text?: string;
  values?: unknown[];
  _result?: { rows?: unknown[] };
  handleCommandComplete: (...args: unknown[]) => unknown;
  submit: (...args: unknown[]) => unknown;
};

export function installProbes() {
  const proto = (pg.Query as unknown as { prototype: SpiedQuery }).prototype;
  const submit = proto.submit;
  proto.submit = function (this: SpiedQuery, ...args: unknown[]) {
    if (
      !paused &&
      watching &&
      this.values?.some((v) => v === watching!.rowId || v === watching!.userId)
    ) {
      traffic.landed = true;
    }
    return submit.apply(this, args);
  };
  const complete = proto.handleCommandComplete;
  proto.handleCommandComplete = function (this: SpiedQuery, ...args: unknown[]) {
    if (!paused && watching && this._result?.rows?.length) {
      const text = JSON.stringify(this._result.rows, (_, v) =>
        typeof v === "bigint" ? String(v) : v,
      );
      if (text.toLowerCase().includes(watching.marker)) {
        traffic.markerRead.push((this.text ?? "").replace(/\s+/g, " ").slice(0, 160));
      }
    }
    return complete.apply(this, args);
  };

  // Nothing leaves: no email, no Plaid, no Anthropic, no webhook to anywhere.
  const fetchGuard = async (input: unknown, init?: { body?: unknown }) => {
    const target = String((input as { url?: string })?.url ?? input);
    traffic.outbound.push(`${target} ${typeof init?.body === "string" ? init.body : ""}`);
    throw new TypeError(`Blocked by the access proof: ${target}`);
  };
  globalThis.fetch = fetchGuard as unknown as typeof fetch;
  const connect = net.Socket.prototype.connect;
  net.Socket.prototype.connect = function (this: net.Socket, ...args: unknown[]) {
    const first = (Array.isArray(args[0]) ? args[0][0] : args[0]) as {
      host?: string;
      path?: string;
    };
    const host = first?.host;
    if (host && !first.path && !["localhost", "127.0.0.1", "::1"].includes(host)) {
      traffic.outbound.push(String(host));
      process.nextTick(() => this.destroy(new Error(`Blocked by the access proof: ${host}`)));
      return this;
    }
    return (connect as (...a: unknown[]) => net.Socket).apply(this, args);
  } as typeof net.Socket.prototype.connect;
}

let client: pg.Client | null = null;

// Queries of the harness's own, on their own connection and out of what the probes count.
export async function asSystem<T>(work: (sql: Sql) => Promise<T>): Promise<T> {
  if (!client) {
    client = new pg.Client({ connectionString: url() });
    await client.connect();
  }
  const sql: Sql = async (text, params) => {
    const result = await client!.query(text, params as unknown[]);
    return result.rows;
  };
  paused++;
  try {
    return await work(sql);
  } finally {
    paused--;
  }
}

export async function closeSystem() {
  await client?.end();
  client = null;
}

export type Write = {
  tbl: string;
  op: string;
  owner: string | null;
  old_owner: string | null;
  points_at: string | null;
};

// A row-level trigger on every table with a user_id, and users itself. SECURITY DEFINER so a write
// made as jane_rls is logged too. Every write goes in, whoever it's for; reads of the log say.
export async function installWriteLog() {
  await asSystem(async (sql) => {
    await sql(`DROP FUNCTION IF EXISTS access_proof_log() CASCADE`);
    await sql(`DROP TABLE IF EXISTS access_proof_writes, access_proof_victims`);
    await sql(`
      CREATE TABLE access_proof_writes (
        tbl text NOT NULL, op text NOT NULL, owner text, old_owner text, points_at text
      )`);
    await sql(`CREATE TABLE access_proof_victims (row_id text PRIMARY KEY)`);
    await sql(`
      CREATE OR REPLACE FUNCTION access_proof_log() RETURNS trigger
      LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
      DECLARE
        new_row jsonb := CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE to_jsonb(NEW) END;
        old_row jsonb := CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE to_jsonb(OLD) END;
        column_name text := TG_ARGV[0];
        reference text;
      BEGIN
        -- A row of someone's that now points at a victim's row, by an id column.
        SELECT e.key INTO reference FROM jsonb_each_text(coalesce(new_row, '{}')) e
        WHERE e.key LIKE '%\\_id' AND e.value IN (SELECT row_id FROM access_proof_victims) LIMIT 1;
        INSERT INTO access_proof_writes (tbl, op, owner, old_owner, points_at)
        VALUES (TG_TABLE_NAME, TG_OP, new_row ->> column_name, old_row ->> column_name, reference);
        RETURN NULL;
      END $$`);
    const tables = await sql<{ table_name: string }>(`
      SELECT c.table_name FROM information_schema.columns c
      JOIN information_schema.tables t USING (table_schema, table_name)
      WHERE c.table_schema = 'public' AND c.column_name = 'user_id' AND t.table_type = 'BASE TABLE'`);
    for (const { table_name: table } of [...tables, { table_name: "users" }]) {
      const column = table === "users" ? "id" : "user_id";
      await sql(`DROP TRIGGER IF EXISTS access_proof_log ON "${table}"`);
      await sql(
        `CREATE TRIGGER access_proof_log AFTER INSERT OR UPDATE OR DELETE ON "${table}"
         FOR EACH ROW EXECUTE FUNCTION access_proof_log('${column}')`,
      );
    }
  });
}

// From here on, a row pointing at one of these is noted.
export async function setVictims(rowIds: string[]) {
  await asSystem(async (sql) => {
    await sql(`DELETE FROM access_proof_victims`);
    for (const id of rowIds) await sql(`INSERT INTO access_proof_victims VALUES ($1)`, [id]);
  });
}

// Takes it all back out of the database, for a run against a database that lives on.
export async function removeWriteLog() {
  await asSystem(async (sql) => {
    await sql(`DROP FUNCTION IF EXISTS access_proof_log() CASCADE`);
    await sql(`DROP TABLE IF EXISTS access_proof_writes, access_proof_victims`);
  });
}

// What was written since the last call, and start over.
export async function takeWrites(): Promise<Write[]> {
  return asSystem((sql) => sql<Write>(`DELETE FROM access_proof_writes RETURNING *`));
}

export async function clearRateLimits() {
  await asSystem((sql) => sql(`DELETE FROM rate_limits`));
}
