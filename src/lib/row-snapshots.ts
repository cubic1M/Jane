import type { PrismaClient } from "@/generated/prisma/client";
import { WHOLE_TABLES, WINDOWED_TABLES } from "@/config/fast-reads";
import { answerFromRows, canAnswer, type FieldInfo, type ModelInfo } from "@/lib/row-eval";

// One page asks a small table twenty ways, and the year's transactions forty (docs/perf/
// fast-pages.md): each question a round trip to the database, six milliseconds on Vercel. Here a
// question about a table that is small (src/config/fast-reads.ts), or about a span inside the
// transactions' window, is answered from one read of the person's rows, held for the length of
// the render or request (the same store as the shared reads, src/lib/read-memo.ts, so a write
// forgets it). Whatever src/lib/row-eval.ts will not answer exactly goes to the database as it
// always did.

type Row = Record<string, unknown>;
type Args = Record<string, unknown>;

// What is held for one person: their rows of one table, or null when there were too many.
export type Rows = Promise<Row[] | null>;

const models = new WeakMap<object, Map<string, ModelInfo>>();

function modelInfo(client: PrismaClient, model: string): ModelInfo | null {
  const data = (
    client as unknown as { _runtimeDataModel?: { models: Record<string, { fields: FieldInfo[] }> } }
  )._runtimeDataModel;
  if (!data?.models?.[model]) return null;
  let known = models.get(data);
  if (!known) models.set(data, (known = new Map()));
  let info = known.get(model);
  if (!info) {
    const hidden = new Set(WHOLE_TABLES[model]?.hidden ?? []);
    info = new Map(
      data.models[model].fields.map((f) => [f.name, { ...f, hidden: hidden.has(f.name) }]),
    );
    known.set(model, info);
  }
  return info;
}

// The first day the transactions' window covers: the start of last year (UTC).
export const windowStart = (now = new Date()) => new Date(Date.UTC(now.getUTCFullYear() - 1, 0, 1));

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !(v instanceof Date) && !Array.isArray(v);

// Whether a transactions question stays inside the window: its date has a lower bound at or after
// the window's start (a question with none, or an earlier one, asks the database).
function insideWindow(where: unknown, from: Date): boolean {
  if (!isObject(where)) return false;
  const found: number[] = [];
  const look = (w: unknown) => {
    if (!isObject(w)) return;
    const date = w.date;
    if (date instanceof Date) found.push(date.getTime());
    else if (isObject(date)) {
      for (const op of ["gte", "gt", "equals"]) {
        const v = date[op];
        if (v instanceof Date) found.push(v.getTime());
      }
    }
    // Every part of an AND must hold, so any one's bound bounds the whole.
    const and = w.AND;
    for (const part of Array.isArray(and) ? and : and === undefined ? [] : [and]) look(part);
  };
  look(where);
  return found.length > 0 && Math.max(...found) >= from.getTime();
}

export type SnapshotContext = {
  client: PrismaClient;
  userId: string;
  model: string;
  operation: string;
  args: Args;
  // The render's or request's store: what it holds goes when anything is written.
  held: Map<string, Promise<unknown>>;
  // One read of the person's rows of this table (with `where`, when given), at most `take`.
  fetch: (where: Args | undefined, take: number) => Promise<Row[]>;
};

// A question about the newest rows (the newest day, the newest few) with no start day: the newest
// are in the window if it holds as many as were asked for, and then they are the answer.
function newestOnly(operation: string, args: Args): boolean {
  const first = Array.isArray(args.orderBy) ? args.orderBy[0] : args.orderBy;
  const byNewest = isObject(first) && first.date === "desc";
  if (operation === "aggregate")
    return Object.keys(args).every((k) => k === "where" || k === "_max") && isObject(args._max);
  return (
    byNewest && (operation === "findFirst" || (operation === "findMany" && args.take !== undefined))
  );
}

// The answer to a read from the person's rows, or null when the database must answer it.
export async function answerFromSnapshot(ctx: SnapshotContext): Promise<{ value: unknown } | null> {
  const { model, operation, args } = ctx;
  const info = modelInfo(ctx.client, model);
  if (!info || !canAnswer(info, operation, args)) return null;
  const windowed = WINDOWED_TABLES[model];
  let rows: Rows;
  let newest = false;
  if (windowed) {
    const from = windowStart();
    if (!insideWindow(args.where, from)) {
      if (!newestOnly(operation, args)) return null;
      newest = true;
    }
    rows = held(ctx, windowed.maxRows, () => ctx.fetch({ date: { gte: from } }, windowed.maxRows));
  } else {
    const table = WHOLE_TABLES[model];
    if (!table) return null;
    rows = held(ctx, table.maxRows, () => ctx.fetch(undefined, table.maxRows));
  }
  const all = await rows;
  const answered = all ? answerFromRows(info, operation, args, all) : null;
  if (!answered || !newest) return answered;
  // Only an answer the window holds in full: a newest row, or as many as were asked for.
  const v = answered.value as unknown;
  if (operation === "aggregate") {
    const max = (v as { _max?: Record<string, unknown> })._max ?? {};
    return Object.values(max).every((x) => x !== null) ? answered : null;
  }
  if (operation === "findFirst") return v === null ? null : answered;
  return Array.isArray(v) && v.length >= (args.take as number) ? answered : null;
}

// One read of the rows per store; a table with more rows than its limit is noted as too big, so
// it is not read again (and the questions go to the database).
function held(ctx: SnapshotContext, limit: number, load: () => Promise<Row[]>): Rows {
  const key = `${ctx.userId}|${ctx.model}|rows`;
  let rows = ctx.held.get(key) as Rows | undefined;
  if (!rows) {
    rows = load().then((found) => (found.length > limit ? null : found));
    ctx.held.set(key, rows);
    // A failed read isn't kept: the next question asks again (and goes to the database now).
    rows.catch(() => {
      if (ctx.held.get(key) === rows) ctx.held.delete(key);
    });
  }
  return rows;
}
