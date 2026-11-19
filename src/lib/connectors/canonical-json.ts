// JSON as Python's json.dumps(value, separators=(",", ":"), sort_keys=True) writes it: keys sorted
// at every level, no spaces, anything outside ASCII as \uXXXX. SnapTrade signs this form.
export function canonicalJson(value: unknown): string {
  const sorted = (v: unknown): unknown =>
    Array.isArray(v)
      ? v.map(sorted)
      : v && typeof v === "object"
        ? Object.fromEntries(
            Object.keys(v as object)
              .sort()
              .map((k) => [k, sorted((v as Record<string, unknown>)[k])]),
          )
        : v;
  return JSON.stringify(sorted(value) ?? null).replace(
    /[\u007f-\uffff]/g,
    (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`,
  );
}
