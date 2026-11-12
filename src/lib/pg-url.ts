// pg (pg-connection-string 2.x) treats sslmode=prefer, require and verify-ca as verify-full, and
// warns "SECURITY WARNING: The SSL modes 'prefer', 'require', and 'verify-ca' are treated as aliases
// for 'verify-full'" on every new instance. Neon's connection strings say sslmode=require. Naming
// verify-full is the same connection (the certificate and host are checked either way) without the
// warning, and stays verify-full when pg 9 gives the other names libpq's weaker meaning.
const ALIASES = new Set(["prefer", "require", "verify-ca"]);

export function withVerifyFull(connectionString: string | undefined): string | undefined {
  if (!connectionString) return connectionString;
  let url: URL;
  try {
    url = new URL(connectionString);
  } catch {
    // Not a URL (a key=value string): left for pg to read as it is.
    return connectionString;
  }
  const mode = url.searchParams.get("sslmode");
  if (!mode || !ALIASES.has(mode) || url.searchParams.has("uselibpqcompat")) {
    return connectionString;
  }
  url.searchParams.set("sslmode", "verify-full");
  return url.toString();
}
