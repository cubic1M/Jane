import { scrub, scrubPath } from "@/lib/scrub";

// A browser's report that the Content-Security-Policy blocked something (src/proxy.ts), boiled
// down to what tells us which rule and where: never the page's query string or a script's text.

export type CspViolation = { directive: string; blocked: string; page: string | null };

const MAX_BODY_BYTES = 20_000;

// What browser extensions inject is theirs, not ours to fix, and would bury real reports.
const EXTENSION_SCHEMES = /^(chrome|moz|safari|safari-web|ms-browser)-extension:/;

// "https://cdn.example.com/a.js?x=1" becomes its origin; "inline", "eval" and the like stay.
function blockedSource(value: unknown): string {
  if (typeof value !== "string" || !value) return "unknown";
  try {
    const url = new URL(value);
    return url.protocol.startsWith("http") ? url.origin : url.protocol.replace(/:$/, "");
  } catch {
    return scrub(value).slice(0, 40);
  }
}

function pagePath(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    return scrubPath(new URL(value).pathname);
  } catch {
    return null;
  }
}

function one(report: Record<string, unknown>): CspViolation | null {
  const directive =
    report["effective-directive"] ?? report.effectiveDirective ?? report["violated-directive"];
  const blocked = report["blocked-uri"] ?? report.blockedURL;
  const source = report["source-file"] ?? report.sourceFile;
  if ([blocked, source].some((v) => typeof v === "string" && EXTENSION_SCHEMES.test(v)))
    return null;
  return {
    directive: typeof directive === "string" ? directive.split(" ")[0].slice(0, 40) : "unknown",
    blocked: blockedSource(blocked),
    page: pagePath(report["document-uri"] ?? report.documentURL),
  };
}

// Both formats: report-uri's {"csp-report": {...}} and the Reporting API's [{type, body}].
export function parseCspReports(raw: string): CspViolation[] {
  if (raw.length > MAX_BODY_BYTES) return [];
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return [];
  }
  const reports = Array.isArray(body)
    ? body.filter((r) => r?.type === "csp-violation").map((r) => r.body)
    : [(body as Record<string, unknown>)?.["csp-report"]];
  return reports
    .filter((r): r is Record<string, unknown> => typeof r === "object" && r !== null)
    .map(one)
    .filter((v): v is CspViolation => v !== null)
    .slice(0, 5);
}
