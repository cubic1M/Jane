import { logAudit } from "@/lib/audit";
import { decryptBytes } from "@/lib/crypto";
import { requireAdmin } from "@/lib/session";
import { systemDb } from "@/lib/system-db";

const ID_PATTERN = /^[a-z0-9]{1,40}$/i;

// A beta tester's feedback screenshot, for the founders only (ADMIN_EMAILS and two-factor): it can
// show the person's money, so it's encrypted at rest, never emailed, never cached, and each view is
// on the audit log and the person's own "who saw my data" page.
export async function GET(
  _request: Request,
  { params }: RouteContext<"/admin/reports/[id]/screenshot">,
) {
  const admin = await requireAdmin();
  const { id } = await params;
  if (!ID_PATTERN.test(id)) return new Response("Not found", { status: 404 });
  const report = await systemDb(
    "Admin page: works across people, behind ADMIN_EMAILS and two-factor",
  ).problemReport.findUnique({
    where: { id },
    select: { userId: true, screenshotEncrypted: true, screenshotType: true },
  });
  if (!report?.screenshotEncrypted || !report.screenshotType) {
    return new Response("Not found", { status: 404 });
  }
  // On the person's "who saw my data" page (src/lib/team-access.ts).
  await logAudit(
    { type: "admin", id: admin.id },
    "admin_viewed_feedback_screenshot",
    { type: "user", id: report.userId },
    { problem_report_id: id },
  );
  return new Response(new Uint8Array(decryptBytes(report.screenshotEncrypted)), {
    headers: {
      "content-type": report.screenshotType,
      "cache-control": "private, no-store",
      "x-content-type-options": "nosniff",
      "content-disposition": "inline",
    },
  });
}
