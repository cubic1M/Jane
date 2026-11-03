// Whether a marker is anywhere in what a caller got back: a body, a return value, a redirect, an
// error, a rendered tree. Case doesn't count: a name can come back upper-cased or title-cased.

function visit(value: unknown, needle: string, path: string, seen: Set<object>): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") return value.toLowerCase().includes(needle) ? path : null;
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
    return null;
  }
  if (typeof value !== "object") return null;
  if (seen.has(value)) return null;
  seen.add(value);
  if (value instanceof Error) {
    const error = value as Error & { digest?: unknown; cause?: unknown };
    return (
      visit(error.message, needle, `${path}.message`, seen) ??
      visit(error.digest, needle, `${path}.digest`, seen) ??
      visit(error.cause, needle, `${path}.cause`, seen)
    );
  }
  if (value instanceof Date) return null;
  if (value instanceof Map) return visit([...value.entries()], needle, path, seen);
  if (value instanceof Set) return visit([...value.values()], needle, path, seen);
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      const found = visit(value[i], needle, `${path}[${i}]`, seen);
      if (found) return found;
    }
    return null;
  }
  for (const key of Object.keys(value)) {
    // A React element's owner and debug fields are the renderer's, not what was sent.
    if (key === "_owner" || key === "_store" || key === "_debugInfo") continue;
    let inner: unknown;
    try {
      inner = (value as Record<string, unknown>)[key];
    } catch {
      continue;
    }
    if (key.toLowerCase().includes(needle)) return `${path}.${key}`;
    const found = visit(inner, needle, `${path}.${key}`, seen);
    if (found) return found;
  }
  return null;
}

// Where in `value` the marker is, or null.
export function findMarker(value: unknown, marker: string): string | null {
  return visit(value, marker.toLowerCase(), "response", new Set());
}
