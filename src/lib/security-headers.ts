// Response headers for every page and API route. Pages get their Content-Security-Policy from
// the proxy (src/proxy.ts), with a fresh nonce per request; everything else is set in
// next.config.ts. docs/security/edge.md explains each one.
//
// Plaid Link's needs come from https://plaid.com/docs/link/web/: its script and frame from
// cdn.plaid.com, and API calls to Plaid's environments. PostHog is only called from the server
// (src/lib/analytics.ts), so the browser never needs it. Fonts are self-hosted by next/font.

export type Header = { key: string; value: string };

// Where the CSP's violation reports go (src/app/api/csp-report/route.ts).
export const CSP_REPORT_PATH = "/api/csp-report";

// 128 random bits, base64: a new one for every page request.
export function newNonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return btoa(String.fromCharCode(...bytes));
}

export function contentSecurityPolicy({
  nonce,
  isDev,
  frameAncestors = "'none'",
}: {
  nonce: string;
  isDev: boolean;
  frameAncestors?: string;
}): string {
  const directives: Record<string, string[]> = {
    "default-src": ["'self'"],
    // Only scripts carrying this request's nonce run, and the scripts they load ('strict-dynamic':
    // Next.js's chunks and Plaid Link). An injected <script> has no nonce, so it doesn't run.
    // cdn.plaid.com is kept for browsers that predate 'strict-dynamic'.
    "script-src": [
      "'self'",
      `'nonce-${nonce}'`,
      "'strict-dynamic'",
      "https://cdn.plaid.com",
      ...(isDev ? ["'unsafe-eval'"] : []),
    ],
    // Inline style attributes (React's style={...}) need 'unsafe-inline'; a nonce here would
    // switch it off, so styles get none. Styles can't run code.
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
    "media-src": ["'self'", "blob:"],
    "frame-ancestors": [frameAncestors],
    "form-action": ["'self'"],
    "base-uri": ["'self'"],
    "object-src": ["'none'"],
    "report-uri": [CSP_REPORT_PATH],
    ...(isDev ? {} : { "upgrade-insecure-requests": [] }),
  };
  return Object.entries(directives)
    .map(([name, values]) => [name, ...values].join(" "))
    .join("; ");
}

// The chat's pages (/chat and under it) may be framed by our own pages only: the side chat
// shows /chat?embed=1 in a frame. Every other page refuses to be framed at all.
export function framedByUs(pathname: string): boolean {
  return pathname === "/chat" || pathname.startsWith("/chat/");
}

// The page CSP for this request (the proxy sets it on the request too, so Next.js puts the
// nonce on its own scripts).
export function pageCsp(pathname: string, nonce: string, isDev: boolean): string {
  return contentSecurityPolicy({
    nonce,
    isDev,
    frameAncestors: framedByUs(pathname) ? "'self'" : "'none'",
  });
}

// API responses are data, never pages: nothing may load or frame them.
export const API_CSP = "default-src 'none'; frame-ancestors 'none'";

// Browser features. The microphone is ours only: speaking to Jane (src/app/chat/mic-button.tsx)
// uses it, in the chat page and in the side chat's frame (which also needs allow="microphone").
export const PERMISSIONS_POLICY = [
  "microphone=(self)",
  "camera=()",
  "geolocation=()",
  "payment=()",
  "usb=()",
  "serial=()",
  "hid=()",
  "bluetooth=()",
  "midi=()",
  "magnetometer=()",
  "gyroscope=()",
  "accelerometer=()",
  "display-capture=()",
  "browsing-topics=()",
  "interest-cohort=()",
].join(", ");

// Every response, from next.config.ts.
export function securityHeaders(isDev: boolean): Header[] {
  return [
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
    { key: "Permissions-Policy", value: PERMISSIONS_POLICY },
    // Other sites can't keep a handle on a Jane window. "allow-popups" keeps Plaid Link's bank
    // sign-in windows (OAuth banks) able to report back.
    { key: "Cross-Origin-Opener-Policy", value: "same-origin-allow-popups" },
    { key: "X-Permitted-Cross-Domain-Policies", value: "none" },
  ];
}

// The chat's pages may be framed by our own pages (see framedByUs). next.config.ts sets this
// after the site-wide headers, which it replaces.
export const CHAT_FRAME_HEADERS: Header[] = [{ key: "X-Frame-Options", value: "SAMEORIGIN" }];

// Uploaded documents opened inline (/api/documents/<id>, spec step 68): sandboxed, with
// nothing loaded alongside, so a crafted PDF or image can't run script on our origin.
// next.config.ts sets it after the API policy, which would otherwise replace it.
export const DOCUMENT_FILE_CSP =
  "sandbox; default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'";
