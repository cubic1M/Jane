import { logAudit } from "@/lib/audit";
import { scrubPath } from "@/lib/scrub";

// Every admin page view and admin action, on the access log (src/config/access-log.ts), from
// the proxy once it knows the request is a verified admin's: the path (never the query
// string), with the IP and browser. Prefetches aren't views; nobody saw the page.

type AdminRequest = { method: string; pathname: string; headers: Headers };

export function adminAccessEvent({ method, headers }: AdminRequest) {
  if (method === "POST" && headers.has("next-action")) return "admin_action" as const;
  if (method !== "GET" || headers.has("next-router-prefetch")) return null;
  return "admin_page_viewed" as const;
}

export async function logAdminAccess(adminId: string, request: AdminRequest): Promise<void> {
  const event = adminAccessEvent(request);
  if (!event) return;
  await logAudit(
    { type: "admin", id: adminId },
    event,
    null,
    { path: scrubPath(request.pathname) },
    { headers: request.headers },
  );
}
