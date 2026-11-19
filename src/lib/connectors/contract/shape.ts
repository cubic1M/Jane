// What an adapter expects of a response, field by field, and what the vendor really sent: the names
// of fields missing or in another shape, never their values.

// "string", "number", "boolean", "array", "object"; a trailing "?" also allows null or missing.
export type Spec = { [field: string]: string | Spec };

const kind = (v: unknown) => (v === null ? "null" : Array.isArray(v) ? "array" : typeof v);

export function shapeMismatches(value: unknown, spec: Spec, path = ""): string[] {
  const out: string[] = [];
  const obj = (value ?? {}) as Record<string, unknown>;
  for (const [field, want] of Object.entries(spec)) {
    const at = path ? `${path}.${field}` : field;
    const got = obj[field];
    if (typeof want === "object") {
      if (kind(got) !== "object")
        out.push(`${at}: expected object, got ${got === undefined ? "nothing" : kind(got)}`);
      else out.push(...shapeMismatches(got, want, at));
      continue;
    }
    const optional = want.endsWith("?");
    const type = want.replace("?", "");
    if (got === undefined || got === null) {
      if (!optional) out.push(`${at}: missing`);
    } else if (kind(got) !== type) {
      out.push(`${at}: expected ${type}, got ${kind(got)}`);
    }
  }
  return out;
}

export type ContractResult = {
  connector: string;
  // null: not tried (keys missing, or no read call to make).
  reachable: boolean | null;
  parsed: boolean | null;
  // Test entities the run made at the vendor, by kind (never their ids).
  created: string[];
  mismatches: string[];
  note: string;
};

const yn = (v: boolean | null) => (v === null ? "not tried" : v ? "yes" : "no");

// One line per connector: yes or no, names of fields, nothing a vendor sent.
export const formatContract = (r: ContractResult) =>
  `${r.connector}: reachable ${yn(r.reachable)}, parsed ${yn(r.parsed)}` +
  (r.created.length ? `, made test ${r.created.join(", ")}` : "") +
  (r.mismatches.length ? `, mismatches: ${r.mismatches.join("; ")}` : ", no mismatches") +
  (r.note ? `. ${r.note}` : "");
