// Answers a simple read from rows already in memory, the way the database would (docs/perf/
// fast-pages.md). One page asks the same small table twenty ways (the person's accounts, their tax
// profile, their goals), each a round trip; the scoped client reads the person's whole table once
// and answers each of those from it (src/lib/db-scoped.ts), when this can answer it exactly.
//
// "Exactly" is the point: it understands only the plain shapes (scalar filters, scalar ordering,
// a scalar select) and returns null for anything else (a relation, a JSON path, a text order the
// database's collation would decide, a cursor), and the caller then asks the database. The
// comparison follows SQL, not JavaScript: a missing value is neither equal nor unequal to
// anything (three-valued logic), and a text search is a LIKE. The integration test checks each
// operator against the real database, and one against another, on a table with missing values.

export type FieldInfo = {
  name: string;
  kind: string;
  type: string;
  isList?: boolean;
  // A column the rows in memory do not carry: a read that wants it is the database's.
  hidden?: boolean;
};
export type ModelInfo = ReadonlyMap<string, FieldInfo>;

type Row = Record<string, unknown>;
type Args = Record<string, unknown>;
// true, false, or unknown (null): SQL's three values.
type Truth = boolean | null;

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !(v instanceof Date) && !Array.isArray(v);

// The scalar types whose comparisons are the same in memory as in the database.
const COMPARABLE = new Set(["Int", "Float", "DateTime", "Boolean"]);
const TEXT = "String";

class Unsupported extends Error {}
const no = (): never => {
  throw new Unsupported();
};

function field(model: ModelInfo, name: string): FieldInfo {
  const f = model.get(name);
  if (!f || f.isList || f.hidden) return no();
  // A relation or a JSON / decimal / big-number column: asked of the database.
  if (f.kind === "object") return no();
  if (f.kind === "scalar" && f.type !== TEXT && !COMPARABLE.has(f.type)) return no();
  return f;
}

// A column that can be handed back: text, numbers, dates, flags, enums and JSON, whose values copy
// plainly (a decimal or a big number is a class of its own).
function column(model: ModelInfo, name: string): FieldInfo {
  const f = model.get(name);
  if (!f || f.isList || f.hidden || f.kind === "object") return no();
  if (f.kind === "scalar" && f.type !== TEXT && f.type !== "Json" && !COMPARABLE.has(f.type))
    return no();
  return f;
}

const isNum = (f: FieldInfo) => f.type === "Int" || f.type === "Float";

// A filter value as a comparable: dates by their instant, numbers and text as they are.
function plain(f: FieldInfo, v: unknown): number | string | boolean {
  if (f.type === "DateTime") {
    if (!(v instanceof Date) && typeof v !== "string") return no();
    const t = new Date(v as Date | string).getTime();
    return Number.isNaN(t) ? no() : t;
  }
  if (f.type === "Boolean") return typeof v === "boolean" ? v : no();
  if (isNum(f)) return typeof v === "number" && Number.isFinite(v) ? v : no();
  return typeof v === "string" ? v : no();
}

// A row's value for the same comparison; null stays null.
function cell(f: FieldInfo, v: unknown): number | string | boolean | null {
  if (v === null || v === undefined) return null;
  if (f.type === "DateTime") return v instanceof Date ? v.getTime() : no();
  return v as number | string | boolean;
}

// A LIKE over the text. The database client leaves a search term's own % and _ as wildcards (one
// or any number of characters), so they are here too; a backslash is the database's escape, which
// is asked of it.
function like(kind: string, value: string, term: string, insensitive: boolean): boolean {
  if (term.includes("\\")) no();
  let text = value;
  let pattern = term;
  if (insensitive) {
    // ILIKE folds case by the database's locale; only the plain ASCII letters fold the same
    // everywhere, so a text with anything else in it is the database's to match.
    if (!/^[\u0000-\u007f]*$/.test(term) || !/^[\u0000-\u007f]*$/.test(value)) no();
    text = text.toLowerCase();
    pattern = pattern.toLowerCase();
  }
  const body = pattern
    .split("")
    .map((c) =>
      c === "%" ? "[\\s\\S]*" : c === "_" ? "[\\s\\S]" : c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
    )
    .join("");
  const re = new RegExp(
    `^${kind === "contains" || kind === "endsWith" ? "[\\s\\S]*" : ""}${body}${kind === "contains" || kind === "startsWith" ? "[\\s\\S]*" : ""}$`,
    "u",
  );
  return re.test(text);
}

function not(t: Truth): Truth {
  return t === null ? null : !t;
}

function and(items: Truth[]): Truth {
  let unknown = false;
  for (const t of items) {
    if (t === false) return false;
    if (t === null) unknown = true;
  }
  return unknown ? null : true;
}

function or(items: Truth[]): Truth {
  let unknown = false;
  for (const t of items) {
    if (t === true) return true;
    if (t === null) unknown = true;
  }
  return unknown ? null : false;
}

// One field's filter against a row's value.
function test(f: FieldInfo, filter: unknown, raw: unknown): Truth {
  const value = cell(f, raw);
  if (filter === null) return value === null;
  if (!isObject(filter)) return value === null ? null : value === plain(f, filter);
  const insensitive = filter.mode === "insensitive";
  if (filter.mode !== undefined && filter.mode !== "insensitive" && filter.mode !== "default") no();
  const parts: Truth[] = [];
  for (const [op, arg] of Object.entries(filter)) {
    if (op === "mode") continue;
    if (op === "equals") {
      parts.push(arg === null ? value === null : value === null ? null : value === plain(f, arg));
    } else if (op === "not") {
      // not: null is "is not null"; not: <value> is "<>", unknown on a missing value.
      if (arg === null) parts.push(value !== null);
      else if (isObject(arg)) parts.push(not(test(f, arg, raw)));
      else parts.push(value === null ? null : value !== plain(f, arg));
    } else if (op === "in" || op === "notIn") {
      if (!Array.isArray(arg)) no();
      const list = (arg as unknown[]).map((x) => plain(f, x));
      if (op === "in")
        parts.push(value === null ? (list.length === 0 ? false : null) : list.includes(value));
      else parts.push(list.length === 0 ? true : value === null ? null : !list.includes(value));
    } else if (op === "lt" || op === "lte" || op === "gt" || op === "gte") {
      // Text order is the database's collation's to decide.
      if (f.type === TEXT || f.type === "Boolean") no();
      const a = plain(f, arg) as number;
      if (value === null) parts.push(null);
      else if (op === "lt") parts.push((value as number) < a);
      else if (op === "lte") parts.push((value as number) <= a);
      else if (op === "gt") parts.push((value as number) > a);
      else parts.push((value as number) >= a);
    } else if (op === "contains" || op === "startsWith" || op === "endsWith") {
      if (f.type !== TEXT || typeof arg !== "string") no();
      parts.push(value === null ? null : like(op, value as string, arg as string, insensitive));
    } else {
      no();
    }
  }
  return and(parts);
}

function where(model: ModelInfo, w: unknown, row: Row): Truth {
  if (w === undefined) return true;
  if (!isObject(w)) return no();
  const parts: Truth[] = [];
  for (const [key, value] of Object.entries(w)) {
    if (value === undefined) continue;
    if (key === "AND" || key === "OR" || key === "NOT") {
      const list = (Array.isArray(value) ? value : [value]).map((x) => where(model, x, row));
      if (key === "AND") parts.push(and(list));
      else if (key === "OR") parts.push(list.length === 0 ? false : or(list));
      // NOT: [a, b] is none of them: not a, and not b.
      else parts.push(and(list.map(not)));
      continue;
    }
    parts.push(test(field(model, key), value, row[key]));
  }
  return and(parts);
}

type Order = { name: string; f: FieldInfo; desc: boolean };

function orders(model: ModelInfo, orderBy: unknown): Order[] {
  if (orderBy === undefined) return [];
  const out: Order[] = [];
  for (const o of Array.isArray(orderBy) ? orderBy : [orderBy]) {
    if (!isObject(o)) no();
    for (const [name, dir] of Object.entries(o as Record<string, unknown>)) {
      const f = field(model, name);
      // Text sorts by the database's collation; only an id (lower-case letters and digits) is safe.
      if (f.type === TEXT && name !== "id") no();
      if (dir !== "asc" && dir !== "desc") no();
      out.push({ name, f, desc: dir === "desc" });
    }
  }
  return out;
}

function compare(a: Row, b: Row, by: Order[]): number {
  for (const { name, f, desc } of by) {
    const x = cell(f, a[name]);
    const y = cell(f, b[name]);
    if (x === y) continue;
    // Nulls are the largest: last when ascending, first when descending (the database's default).
    if (x === null) return desc ? -1 : 1;
    if (y === null) return desc ? 1 : -1;
    const d = x < y ? -1 : 1;
    return desc ? -d : d;
  }
  return 0;
}

function nat(v: unknown): number | undefined {
  if (v === undefined) return undefined;
  return typeof v === "number" && Number.isInteger(v) && v >= 0 ? v : no();
}

// The picked columns of a row, as the database client returns them: the select's names in the
// order the select lists them, or every column.
function pick(model: ModelInfo, select: unknown, row: Row): Row {
  const names =
    select === undefined
      ? [...model.values()]
          .filter((f) => f.kind !== "object")
          .map((f) => column(model, f.name).name)
      : isObject(select)
        ? Object.entries(select).flatMap(([k, v]) => {
            if (v === false) return [];
            if (v !== true) return no();
            return [column(model, k).name];
          })
        : no();
  const out: Row = {};
  for (const n of names) out[n] = copyValue(row[n]);
  return out;
}

// What a caller gets is its own: a date or JSON value is copied.
function copyValue(v: unknown): unknown {
  if (v instanceof Date) return new Date(v.getTime());
  if (typeof v === "object" && v !== null) return structuredClone(v);
  return v;
}

const READS = new Set(["findMany", "findFirst", "findUnique", "count", "aggregate"]);

// Whether this read could be answered here (a quick look before any rows are fetched).
export function evaluable(operation: string, args: Args | undefined): boolean {
  if (!READS.has(operation)) return false;
  const a = args ?? {};
  const allowed =
    operation === "count"
      ? ["where", "orderBy", "skip", "take"]
      : operation === "aggregate"
        ? ["where", "_min", "_max", "_sum", "_count", "orderBy", "skip", "take"]
        : ["where", "select", "orderBy", "skip", "take"];
  return Object.keys(a).every((k) => allowed.includes(k) || a[k] === undefined);
}

// Whether a read has a shape this can answer, judged before any rows are fetched: its filter,
// order, select and paging are tried on a row of nothing but missing values.
export function canAnswer(model: ModelInfo, operation: string, args: Args | undefined): boolean {
  if (!evaluable(operation, args)) return false;
  try {
    const a = args ?? {};
    const blank: Row = Object.fromEntries([...model.keys()].map((k) => [k, null]));
    orders(model, a.orderBy);
    nat(a.skip);
    nat(a.take);
    where(model, a.where, blank);
    if (operation === "aggregate") return aggregate(model, a, []) !== null;
    if (operation !== "count") pick(model, a.select, blank);
    return true;
  } catch (e) {
    if (e instanceof Unsupported) return false;
    throw e;
  }
}

// The answer to a read over `rows`, or null when it isn't one this can answer exactly.
export function answerFromRows(
  model: ModelInfo,
  operation: string,
  args: Args | undefined,
  rows: readonly Row[],
): { value: unknown } | null {
  if (!evaluable(operation, args)) return null;
  try {
    const a = args ?? {};
    const by = orders(model, a.orderBy);
    const skip = nat(a.skip);
    const take = nat(a.take);
    let found = rows.filter((r) => where(model, a.where, r) === true);
    if (by.length > 0) found = [...found].sort((x, y) => compare(x, y, by));
    if (operation === "count") {
      if (a.orderBy !== undefined || a.skip !== undefined || a.take !== undefined) return null;
      return { value: found.length };
    }
    if (operation === "aggregate") return aggregate(model, a, found);
    if (skip) found = found.slice(skip);
    if (operation === "findFirst" || operation === "findUnique")
      return { value: found[0] ? pick(model, a.select, found[0]) : null };
    if (take !== undefined) found = found.slice(0, take);
    return { value: found.map((r) => pick(model, a.select, r)) };
  } catch (e) {
    if (e instanceof Unsupported) return null;
    throw e;
  }
}

// _min, _max, _sum and _count over the matched rows, as the client reports them: a sum or a
// minimum of no rows is null, a count is a number.
function aggregate(model: ModelInfo, a: Args, rows: readonly Row[]): { value: unknown } | null {
  if (a.orderBy !== undefined || a.skip !== undefined || a.take !== undefined) return null;
  const out: Record<string, unknown> = {};
  for (const fn of Object.keys(a).filter((k) => ["_count", "_min", "_max", "_sum"].includes(k)) as (
    "_count" | "_min" | "_max" | "_sum"
  )[]) {
    const spec = a[fn];
    if (spec === undefined) continue;
    if (spec === true && fn === "_count") {
      out._count = rows.length;
      continue;
    }
    if (!isObject(spec)) return no();
    const part: Record<string, unknown> = {};
    for (const [name, on] of Object.entries(spec)) {
      if (on !== true) return no();
      if (name === "_all" && fn === "_count") {
        part._all = rows.length;
        continue;
      }
      const f = field(model, name);
      const values = rows.map((r) => r[name]).filter((v) => v !== null && v !== undefined);
      if (fn === "_count") part[name] = values.length;
      else if (fn === "_sum") {
        if (!isNum(f)) return no();
        part[name] = values.length === 0 ? null : (values as number[]).reduce((s, v) => s + v, 0);
      } else {
        // The smallest or largest, by the same order the database uses (numbers and dates).
        if (f.type === TEXT || f.type === "Boolean") return no();
        let best: unknown = null;
        for (const v of values) {
          const c = cell(f, v) as number;
          if (
            best === null ||
            (fn === "_min" ? c < (cell(f, best) as number) : c > (cell(f, best) as number))
          )
            best = v;
        }
        part[name] = best === null ? null : copyValue(best);
      }
    }
    out[fn] = part;
  }
  return { value: out };
}
