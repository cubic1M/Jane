import { NextResponse, type NextRequest } from "next/server";
import { logAudit } from "@/lib/audit";
import { limitOrNull } from "@/lib/rate-limit";
import { getCurrentUser } from "@/lib/session";
import { loadTaxPack } from "@/lib/tax-pack";
import { taxPackCsv, taxYearFrom } from "@/planning/tax-pack";

// The tax-time pack as a CSV (spec step 72): the signed-in person's own transactions only.
export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const limited = await limitOrNull("taxPack", user.id);
  if (limited) return limited;

  const now = new Date();
  const year = taxYearFrom(
    request.nextUrl.searchParams.get("year") ?? undefined,
    now.toISOString().slice(0, 10),
  );
  const pack = await loadTaxPack(user.id, year, { now });
  const csv = taxPackCsv(pack);
  await logAudit(
    { type: "user", id: user.id },
    "tax_pack_downloaded",
    { type: "user", id: user.id },
    {
      year,
      // Transactions in it, not the summary lines.
      rows:
        pack.charity.rows.length +
        Object.values(pack.preparer).reduce((n, g) => n + g.rows.length, 0) +
        pack.income.rows.length,
    },
  );
  return new NextResponse(csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="tax-time-pack-${year}.csv"`,
      "cache-control": "no-store",
    },
  });
}
