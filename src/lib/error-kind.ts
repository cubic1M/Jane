// What's safe to say about an error to anyone outside the app: its class and its place.

// The kind of error ("TypeError") from a stored message ("TypeError: ..."), nothing after it.
export function errorKind(message: string): string {
  const name = message.split(":")[0].trim();
  return /^[A-Za-z][\w.]{0,60}$/.test(name) ? name : "Error";
}

// A path with nothing that could name someone: any part with a digit, or a long one (an id),
// becomes ":id"; no query string.
export function safePath(path: string | null | undefined): string {
  if (!path) return "(no path)";
  return (
    path
      .split("?")[0]
      .split("/")
      .map((part) => (/\d/.test(part) || part.length > 24 ? ":id" : part))
      .join("/")
      .slice(0, 120) || "/"
  );
}
