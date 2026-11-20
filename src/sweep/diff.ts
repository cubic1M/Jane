// The calendar sweep's comparisons (gate C, mvp-ready.md): what a person sees, flattened to one
// value per path, and what changed between two moments. Pure, so the rules are tested on their own.

export type Flat = Record<string, string | number | boolean | null>;

// Every leaf of a value, by its path ("home.safeToSpend.cents", "trees.money.tree.branches.coming
// .items.coming:week.label"). A list whose entries each have their own id (or key) is keyed by it,
// so one entry coming or going names itself instead of shifting every one after it; other lists
// go by position. Dates become their ISO text; functions and undefined are left out.
export function flatten(value: unknown, prefix = "", out: Flat = {}, depth = 0): Flat {
  if (depth > 12) return out;
  if (value === null) {
    out[prefix] = null;
  } else if (value instanceof Date) {
    out[prefix] = Number.isNaN(value.getTime()) ? "Invalid Date" : value.toISOString();
  } else if (Array.isArray(value)) {
    out[`${prefix}.length`] = value.length;
    const names = value.map(nameOf);
    const named = names.every((n) => n !== null) && new Set(names).size === names.length;
    value.forEach((item, i) => flatten(item, `${prefix}.${named ? names[i] : i}`, out, depth + 1));
  } else if (value instanceof Map) {
    for (const [k, v] of value) flatten(v, `${prefix}.${String(k)}`, out, depth + 1);
  } else if (value instanceof Set) {
    flatten([...value].sort(), prefix, out, depth);
  } else if (typeof value === "object") {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      flatten(v, prefix ? `${prefix}.${k}` : k, out, depth + 1);
    }
  } else if (typeof value === "bigint") {
    out[prefix] = Number(value);
  } else if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    out[prefix] = value;
  }
  return out;
}

// An entry's own name: its id, else its key, when it has one as text.
function nameOf(item: unknown): string | null {
  if (typeof item !== "object" || item === null) return null;
  const { id, key } = item as { id?: unknown; key?: unknown };
  return typeof id === "string" && id ? id : typeof key === "string" && key ? key : null;
}

export type Change = {
  path: string;
  before: Flat[string] | undefined;
  after: Flat[string] | undefined;
};

// What differs between two snapshots, path by path, in path order.
export function changes(before: Flat, after: Flat): Change[] {
  const paths = [...new Set([...Object.keys(before), ...Object.keys(after)])].sort();
  return paths
    .filter((p) => before[p] !== after[p])
    .map((p) => ({ path: p, before: before[p], after: after[p] }));
}

// The days from one ISO day to another, inclusive.
export function daysFrom(first: string, last: string): string[] {
  const out: string[] = [];
  for (
    let t = Date.parse(`${first}T00:00:00Z`);
    t <= Date.parse(`${last}T00:00:00Z`);
    t += 86_400_000
  ) {
    out.push(new Date(t).toISOString().slice(0, 10));
  }
  return out;
}

// A wall-clock time on a day in a time zone, as the moment it is (3pm on Nov 15 in Los Angeles is
// 23:00Z in winter and 22:00Z in summer). Exact on either side of a DST change and for zones a
// half hour off (Kolkata).
export function atLocal(day: string, hour: number, timeZone: string): Date {
  const wanted = Date.parse(`${day}T${String(hour).padStart(2, "0")}:00:00Z`);
  // The zone's wall clock at a moment, read as if it were UTC.
  const wall = (t: number) => {
    const p = Object.fromEntries(
      new Intl.DateTimeFormat("en-US", {
        timeZone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23",
      })
        .formatToParts(t)
        .map((x) => [x.type, x.value]),
    );
    return Date.parse(`${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:00Z`);
  };
  // The offset at the guess, then at the answer (they differ only across a DST change).
  let t = wanted - (wall(wanted) - wanted);
  t = wanted - (wall(t) - t);
  if (wall(t) !== wanted) throw new Error(`No ${hour}:00 on ${day} in ${timeZone}`);
  return new Date(t);
}

// A day's change is explained when its path is one the sweep names as dated (a count of days, a
// "today"/"in 3 days" word, a due date) or the day is one on which the person's dated things
// happen (a bill due, a payday, a month's start). Anything else that moves is a finding.
// A reason with `follows` is for a value that sums up others (a tree's "2 urgent · 6 to look at"
// counts its items): it explains the change only when, the same day, a change to what it sums up
// (`follows(path)` matches that change's path) is explained by a reason of its own.
// `on` may read the person's own dates: the day they linked or uploaded, their newest line, and
// each account's newest line.
// A reason with `holds` explains a change only when the day's two snapshots add up the way it says
// (the tax year's turn: the new year's figure is its month as a year, last year's is yesterday's),
// so a figure that moves by a cent more than that is still a finding. Without the snapshots, never.
export type Dates = { linked: string; lastLine: string; accountsLast?: string[] };
export type Reason = {
  name: string;
  paths: RegExp;
  on?: (day: string, person: Dates) => boolean;
  follows?: (path: string) => RegExp;
  holds?: (before: Flat, after: Flat) => boolean;
};

export function unexplained(
  day: string,
  found: Change[],
  reasons: readonly Reason[],
  person: Dates = { linked: "", lastLine: "", accountsLast: [] },
  flats?: { before: Flat; after: Flat },
): Change[] {
  const holds = (r: Reason) =>
    !r.holds || (flats !== undefined && r.holds(flats.before, flats.after));
  const named = (c: Change, r: Reason) =>
    r.paths.test(c.path) && (r.on ? r.on(day, person) : true) && holds(r);
  const direct = reasons.filter((r) => !r.follows);
  const explained = (c: Change) => direct.some((r) => named(c, r));
  return found.filter(
    (c) =>
      !explained(c) &&
      !reasons.some(
        (r) =>
          r.follows &&
          named(c, r) &&
          found.some((o) => o !== c && r.follows!(c.path).test(o.path) && explained(o)),
      ),
  );
}
