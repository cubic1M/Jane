import { NextResponse, type NextRequest } from "next/server";
import { logAudit } from "@/lib/audit";
import { loadAuditRecords } from "@/lib/audit-records";
import { limitOrNull } from "@/lib/rate-limit";
import { getCurrentUser } from "@/lib/session";
import { auditPackCsv } from "@/planning/audit-records";
import { taxYearFrom } from "@/planning/tax-pack";

// The audit pack for a tax year as a CSV (spec step 171): every deduction and credit with
// its sources. The signed-in person's own records only.
export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const limited = await limitOrNull("auditPack", user.id);
  if (limited) return limited;

  const now = new Date();
  const year = taxYearFrom(
    request.nextUrl.searchParams.get("year") ?? undefined,
    now.toISOString().slice(0, 10),
  );
  const pack = await loadAuditRecords(user.id, year, { now });
  await logAudit(
    { type: "user", id: user.id },
    "audit_pack_downloaded",
    { type: "user", id: user.id },
    { year, items: pack.items.length, gaps: pack.gaps.length },
  );
  return new NextResponse(auditPackCsv(pack), {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="audit-pack-${year}.csv"`,
      "cache-control": "no-store",
    },
  });
}
