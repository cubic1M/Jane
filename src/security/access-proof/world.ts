import { TRIAL_EMAIL_DOMAIN, TRIAL_ID_PREFIX } from "@/config/trial";
import { TERMS_VERSION } from "@/config/legal";
import { encryptBytes } from "@/lib/crypto";
import { db } from "@/lib/db";
import { linkDemoBank } from "@/lib/plaid/demo";
import { syncItem } from "@/lib/plaid/sync";
import { acceptTerms } from "@/lib/terms";
import { asSystem } from "./probe";

// The people in the attack, and the rows they own. Each owned table gets a row of the victim's
// whose id is the same string in every table (rowId), so an attacker's one id fits any parameter,
// with a marker in everything a person could read. A real sync comes first, so as many rows as
// possible have the shape the code expects (a row the code chokes on would hide a leak behind an
// error); a table the sync didn't reach gets a row built from the catalog.

export type Person = {
  label: string;
  userId: string;
  rowId: string;
  marker: string;
  email: string;
  sessionToken: string;
};

// 25 characters starting with c: passes every id check a cuid passes.
const person = (label: string, tag: string, userPrefix = ""): Person => {
  const marker = `zqmark${tag}${label}zq`;
  return {
    label,
    userId: `${userPrefix}c${tag}${label}user`.padEnd(userPrefix.length + 25, "0"),
    rowId: `c${tag}${label}row`.padEnd(25, "0"),
    marker,
    // A trial person's address is on a domain that can't receive mail (src/config/trial.ts).
    email: `${marker}@${userPrefix ? TRIAL_EMAIL_DOMAIN : "example.com"}`,
    sessionToken: `access-proof-session-${label}-${tag}`,
  };
};

export const PEOPLE = {
  alice: person("alice", "aa"),
  bob: person("bob", "bb"),
  dana: person("dana", "dd"),
  tess: person("tess", "tt", TRIAL_ID_PREFIX),
  hana: person("hana", "hh"),
} as const;

type Column = {
  table_name: string;
  column_name: string;
  data_type: string;
  udt_name: string;
  is_nullable: string;
  has_default: boolean;
};
type ForeignKey = {
  table_name: string;
  column_name: string;
  target: string;
  target_column: string;
};

// A person's free text: where a real row's words go, and so where a marker can stand in for them.
const FREE_TEXT =
  /(^|_)(name|title|summary|description|note|notes|body|text|content|memo|label|subject|reason|message|headline|detail|details|merchant|explanation|comment|question|answer)(_|$)/;
const NEVER_MARK =
  /(^|_)(id|key|type|status|hash|token|kind|category|slug|code|state|mask|source)$/;

const quote = (name: string) => `"${name.replace(/"/g, '""')}"`;

async function catalog() {
  return asSystem(async (sql) => {
    const columns = await sql<Column>(`
      SELECT c.table_name, c.column_name, c.data_type, c.udt_name, c.is_nullable,
             c.column_default IS NOT NULL OR c.is_identity = 'YES' AS has_default
      FROM information_schema.columns c
      JOIN information_schema.tables t USING (table_schema, table_name)
      WHERE c.table_schema = 'public' AND t.table_type = 'BASE TABLE'
      ORDER BY c.table_name, c.ordinal_position`);
    const foreignKeys = await sql<ForeignKey>(`
      SELECT src.relname AS table_name, a.attname AS column_name,
             dst.relname AS target, b.attname AS target_column
      FROM pg_constraint k
      JOIN pg_class src ON src.oid = k.conrelid
      JOIN pg_class dst ON dst.oid = k.confrelid
      JOIN pg_namespace n ON n.oid = src.relnamespace AND n.nspname = 'public'
      JOIN unnest(k.conkey) WITH ORDINALITY AS ck(attnum, i) ON true
      JOIN unnest(k.confkey) WITH ORDINALITY AS fk(attnum, i) ON fk.i = ck.i
      JOIN pg_attribute a ON a.attrelid = src.oid AND a.attnum = ck.attnum
      JOIN pg_attribute b ON b.attrelid = dst.oid AND b.attnum = fk.attnum
      WHERE k.contype = 'f'`);
    const enums = await sql<{ typname: string; label: string }>(`
      SELECT t.typname, min(e.enumlabel) AS label
      FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid GROUP BY t.typname`);
    const owned = await sql<{ table_name: string; kind: string }>(
      `SELECT table_name, kind FROM jane_rls_plan() WHERE kind IN ('owner', 'child')`,
    );
    const primaryKeys = await sql<{ table_name: string; column_name: string }>(`
      SELECT c.relname AS table_name, a.attname AS column_name
      FROM pg_index i
      JOIN pg_class c ON c.oid = i.indrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
      JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = ANY(i.indkey)
      WHERE i.indisprimary`);
    return { columns, foreignKeys, enums, owned, primaryKeys };
  });
}

// Everything but ids, keys and the like: the words a person's row holds.
function markableColumn(column: Column): boolean {
  return (
    (column.udt_name === "text" || column.udt_name === "varchar") &&
    FREE_TEXT.test(column.column_name) &&
    !NEVER_MARK.test(column.column_name)
  );
}

// Moves one of the person's real rows in each table onto rowId (foreign keys follow, ON UPDATE
// CASCADE) and writes the marker into the words of all of them.
async function markRealRows(who: Person, info: Awaited<ReturnType<typeof catalog>>) {
  const byTable = Map.groupBy(info.columns, (c) => c.table_name);
  const primary = Map.groupBy(info.primaryKeys, (k) => k.table_name);
  const reached: string[] = [];
  await asSystem(async (sql) => {
    for (const { table_name: table, kind } of info.owned) {
      if (kind !== "owner") continue;
      const columns = byTable.get(table) ?? [];
      const singleId =
        primary.get(table)?.length === 1 && primary.get(table)?.[0].column_name === "id";
      const rows = await sql(`SELECT 1 FROM ${quote(table)} WHERE user_id = $1 LIMIT 1`, [
        who.userId,
      ]);
      if (rows.length === 0) continue;
      reached.push(table);
      if (singleId) {
        await sql(
          `UPDATE ${quote(table)} SET id = $2 WHERE id = (
             SELECT id FROM ${quote(table)} WHERE user_id = $1 ORDER BY id LIMIT 1)`,
          [who.userId, who.rowId],
        );
      }
      const sets = [
        ...columns
          .filter(markableColumn)
          .map(
            (c) =>
              `${quote(c.column_name)} = coalesce(${quote(c.column_name)} || ' ', '') || $2::text`,
          ),
        ...columns
          .filter((c) => c.udt_name === "jsonb")
          .map(
            (c) =>
              `${quote(c.column_name)} = CASE WHEN jsonb_typeof(${quote(c.column_name)}) = 'object'
                 THEN ${quote(c.column_name)} || jsonb_build_object('proofMarker', $2::text)
                 ELSE ${quote(c.column_name)} END`,
          ),
      ];
      if (sets.length > 0) {
        // A row the marker can't go on (a CHECK, a unique pair) keeps its words: other rows have it.
        await sql(`UPDATE ${quote(table)} SET ${sets.join(", ")} WHERE user_id = $1`, [
          who.userId,
          who.marker,
        ]).catch(() => undefined);
      }
    }
  });
  return reached;
}

// A row for each owned table the sync didn't reach, built from the catalog. Tried until nothing
// more goes in, since a row may need another table's first.
async function plantCatalogRows(
  who: Person,
  info: Awaited<ReturnType<typeof catalog>>,
  skip: Set<string>,
) {
  const byTable = Map.groupBy(info.columns, (c) => c.table_name);
  const keys = Map.groupBy(info.foreignKeys, (k) => k.table_name);
  const enumLabel = new Map(info.enums.map((e) => [e.typname, e.label]));
  const done = new Set(skip);
  const failures = new Map<string, string>();
  // The tables an owned row can't exist without (a household, a referral partner) go in too.
  const wanted = new Set(info.owned.map((o) => o.table_name));
  for (const table of [...wanted]) {
    for (const key of keys.get(table) ?? []) {
      const column = byTable.get(table)?.find((c) => c.column_name === key.column_name);
      if (key.target !== "users" && column?.is_nullable === "NO") wanted.add(key.target);
    }
  }
  let queue = [...wanted].filter((t) => !done.has(t));

  const valueFor = (table: string, column: Column): { sql: string; param?: unknown } | null => {
    const key = keys.get(table)?.find((k) => k.column_name === column.column_name);
    if (key) {
      if (key.target === "users") return { sql: "$", param: who.userId };
      if (done.has(key.target) && key.target_column === "id") return { sql: "$", param: who.rowId };
      if (column.is_nullable === "YES") return null;
      return { sql: "$", param: who.rowId };
    }
    if (column.column_name === "user_id") return { sql: "$", param: who.userId };
    if (column.column_name === "id") return { sql: "$", param: who.rowId };
    const required = column.is_nullable === "NO" && !column.has_default;
    if (column.udt_name === "text" || column.udt_name === "varchar") {
      if (column.has_default) return null;
      // An id with no foreign key behind it still names a row.
      if (column.is_nullable === "NO" && column.column_name.endsWith("_id")) {
        return { sql: "$", param: who.rowId };
      }
      return required || FREE_TEXT.test(column.column_name)
        ? { sql: "$", param: `${who.marker} ${table}` }
        : null;
    }
    if (column.udt_name === "jsonb") {
      return required || !column.has_default
        ? { sql: "$::jsonb", param: JSON.stringify([who.marker]) }
        : null;
    }
    if (!required) return null;
    if (column.udt_name === "_text") return { sql: "$", param: [who.marker] };
    if (column.udt_name === "bytea") return { sql: "$", param: Buffer.from(who.marker) };
    if (column.udt_name === "bool") return { sql: "false" };
    if (column.udt_name === "timestamptz" || column.udt_name === "timestamp")
      return { sql: "now()" };
    if (column.udt_name === "date") return { sql: "current_date" };
    if (/^(int|float|numeric)/.test(column.udt_name)) return { sql: "1" };
    const label = enumLabel.get(column.udt_name);
    if (label) return { sql: `'${label}'::${quote(column.udt_name)}` };
    return null;
  };

  await asSystem(async (sql) => {
    for (let pass = 0; pass < 6 && queue.length > 0; pass++) {
      const left: string[] = [];
      for (const table of queue) {
        const names: string[] = [];
        const values: string[] = [];
        const params: unknown[] = [];
        for (const column of byTable.get(table) ?? []) {
          const value = valueFor(table, column);
          if (!value) continue;
          names.push(quote(column.column_name));
          if (value.sql.startsWith("$")) {
            params.push(value.param);
            values.push(`$${params.length}${value.sql.slice(1)}`);
          } else values.push(value.sql);
        }
        try {
          await sql(
            // A household or referral partner an earlier run left behind is as good as a new one.
            `INSERT INTO ${quote(table)} (${names.join(", ")}) VALUES (${values.join(", ")})
             ON CONFLICT DO NOTHING`,
            params,
          );
          done.add(table);
          failures.delete(table);
        } catch (error) {
          failures.set(table, String((error as Error).message));
          left.push(table);
        }
      }
      if (left.length === queue.length) break;
      queue = left;
    }
  });
  return { planted: done, failures };
}

async function createPerson(who: Person, { role }: { role?: "admin" } = {}) {
  // Left by an earlier run, or by an action that deleted them.
  await asSystem(async (sql) => {
    await sql(`DELETE FROM users WHERE id = $1`, [who.userId]);
    await sql(`DELETE FROM households WHERE id = $1`, [who.rowId]);
  });
  await db.user.create({
    data: { id: who.userId, email: who.email, name: who.marker, ...(role ? { role } : {}) },
  });
  await acceptTerms(who.userId, { via: "trial" });
  await db.session.create({
    data: {
      sessionToken: who.sessionToken,
      userId: who.userId,
      expires: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      ...(role ? { mfaVerifiedAt: new Date() } : {}),
    },
  });
}

// An uploaded file is only read through decryption, which would throw on a plain marker and hide a
// leak behind the error: it holds the marker, sealed the way the app seals it. (A Plaid token, the
// only other encrypted column on an owned table, comes real from the demo bank.)
async function sealDocuments(who: Person) {
  await asSystem((sql) =>
    sql(
      `UPDATE documents SET encrypted_bytes = $2, content_type = 'application/pdf' WHERE user_id = $1`,
      [who.userId, encryptBytes(Buffer.from(`%PDF ${who.marker}`))],
    ),
  );
}

export type Planted = { reached: string[]; failures: Map<string, string> };

// A whole person: signed up, on the current Terms, with a synced demo bank and a marked row in
// every owned table.
export async function plantPerson(who: Person, { bank = true } = {}): Promise<Planted> {
  await createPerson(who);
  if (bank) {
    const { itemId } = await linkDemoBank(who.userId);
    await syncItem(itemId);
  }
  const info = await catalog();
  const reached = await markRealRows(who, info);
  const { failures } = await plantCatalogRows(who, info, new Set(reached));
  await sealDocuments(who);
  return { reached, failures };
}

// A person with real data as well as sample data: a CSV account next to the demo bank turns demo
// advice off, so what they reach is what a real account reaches (src/lib/advice-mode.ts).
export async function makeReal(who: Person) {
  await asSystem((sql) =>
    sql(`UPDATE accounts SET source = 'csv' WHERE user_id = $1 AND id = $2`, [
      who.userId,
      who.rowId,
    ]),
  );
}

export const SHARED_MARKER = "zqsharedokzq";

// A partner in the owner's household. The owner shares one account: its transaction and a finding
// on it carry SHARED_MARKER, which the partner may see, and everything else carries the owner's
// own marker, which the partner may not.
export async function plantHousehold(owner: Person, partner: Person) {
  await asSystem(async (sql) => {
    // A partner sees who they share with: the owner's name and email are shared by design.
    await sql(`UPDATE users SET email = $2, name = $3 WHERE id = $1`, [
      owner.userId,
      `${SHARED_MARKER}@example.com`,
      SHARED_MARKER,
    ]);
    await sql(`DELETE FROM accounts WHERE id = $1`, [`${owner.rowId.slice(0, 23)}sa`]);
    await sql(`DELETE FROM household_members WHERE user_id = $1`, [partner.userId]);
    await sql(`INSERT INTO household_members (id, household_id, user_id) VALUES ($1, $2, $3)`, [
      `${partner.rowId.slice(0, 23)}hm`,
      owner.rowId,
      partner.userId,
    ]);
    const [item] = await sql<{ id: string }>(
      `SELECT id FROM plaid_items WHERE user_id = $1 LIMIT 1`,
      [owner.userId],
    );
    const sharedAccount = await db.account.create({
      data: {
        id: `${owner.rowId.slice(0, 23)}sa`,
        userId: owner.userId,
        source: "plaid",
        itemId: item.id,
        name: SHARED_MARKER,
        type: "depository",
        sharedWithHousehold: true,
      },
    });
    await db.transaction.create({
      data: {
        id: `${owner.rowId.slice(0, 23)}st`,
        userId: owner.userId,
        accountId: sharedAccount.id,
        source: "plaid",
        date: new Date(),
        amountCents: 1234,
        description: SHARED_MARKER,
        merchantName: SHARED_MARKER,
      },
    });
  });
}

export async function leaveHouseholdRow(partner: Person) {
  await asSystem((sql) =>
    sql(`DELETE FROM household_members WHERE user_id = $1`, [partner.userId]),
  );
}

// The attacker's account row back as it was, so one action's effect (Terms withdrawn, two-factor
// turned on, the account deleted) doesn't stop the next attack at the door.
export async function restorePerson(who: Person, plant: () => Promise<unknown>) {
  const rows = await asSystem((sql) =>
    sql<{ terms_version: string | null }>(`SELECT terms_version FROM users WHERE id = $1`, [
      who.userId,
    ]),
  );
  if (rows.length === 0) {
    await plant();
    return;
  }
  if (rows[0].terms_version !== TERMS_VERSION) await acceptTerms(who.userId, { via: "trial" });
  await asSystem(async (sql) => {
    await sql(`UPDATE users SET mfa_enabled_at = NULL, role = 'user' WHERE id = $1`, [who.userId]);
    await sql(
      `INSERT INTO sessions (id, session_token, user_id, expires)
       VALUES ($1, $2, $3, now() + interval '7 days')
       ON CONFLICT (session_token) DO UPDATE SET expires = EXCLUDED.expires`,
      [who.rowId, who.sessionToken, who.userId],
    );
  });
}
