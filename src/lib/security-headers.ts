// Response headers for every page and API route (wired up in next.config.ts).
// Plaid Link's needs come from https://plaid.com/docs/link/web/: its script and frame
// from cdn.plaid.com, and API calls to Plaid's environments. Next.js's inline scripts
// need 'unsafe-inline' without nonces, which would make every page dynamic.

export type Header = { key: string; value: string };

export function contentSecurityPolicy(
  isDev: boolean,
  { frameAncestors = "'none'" }: { frameAncestors?: string } = {},
): string {
  const directives: Record<string, string[]> = {
    "default-src": ["'self'"],
    "script-src": [
      "'self'",
      "'unsafe-inline'",
      "https://cdn.plaid.com",
      ...(isDev ? ["'unsafe-eval'"] : []),
    ],
    "style-src": ["'self'", "'unsafe-inline'"],
    "img-src": ["'self'", "data:", "blob:"],
    "font-src": ["'self'", "data:"],
    "connect-src": [
      "'self'",
      "https://production.plaid.com",
      "https://sandbox.plaid.com",
      ...(isDev ? ["ws:"] : []),
    ],
    // Our own chat, docked beside every page (docs/design/home-hub.md), and Plaid Link.
    "frame-src": ["'self'", "https://cdn.plaid.com"],
    // The service worker (public/sw.js) and the web app manifest.
    "worker-src": ["'self'"],
    "manifest-src": ["'self'"],
    "frame-ancestors": [frameAncestors],
    "form-action": ["'self'"],
    "base-uri": ["'self'"],
    "object-src": ["'none'"],
    ...(isDev ? {} : { "upgrade-insecure-requests": [] }),
  };
  return Object.entries(directives)
    .map(([name, values]) => [name, ...values].join(" "))
    .join("; ");
}

export function securityHeaders(isDev: boolean): Header[] {
  return [
    { key: "Content-Security-Policy", value: contentSecurityPolicy(isDev) },
    ...(isDev
      ? []
      : [
          {
            key: "Strict-Transport-Security",
            value: "max-age=63072000; includeSubDomains; preload",
          },
        ]),
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "X-Frame-Options", value: "DENY" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
  ];
}

// The chat's pages (/chat and under it) may be framed by our own pages only: the side chat
// shows /chat?embed=1 in a frame. Every other page still refuses to be framed at all.
// next.config.ts sets these after the site-wide headers, which they replace.
export function chatFrameHeaders(isDev: boolean): Header[] {
  return [
    {
      key: "Content-Security-Policy",
      value: contentSecurityPolicy(isDev, { frameAncestors: "'self'" }),
    },
    { key: "X-Frame-Options", value: "SAMEORIGIN" },
  ];
}

// Uploaded documents opened inline (/api/documents/<id>, spec step 68): sandboxed, with
// nothing loaded alongside, so a crafted PDF or image can't run script on our origin.
// next.config.ts sets it after the site-wide headers, which would otherwise replace it.
export const DOCUMENT_FILE_CSP =
  "sandbox; default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'";
