import { redirect } from "next/navigation";
import { Suspense } from "react";

// The monthly check-in (spec step 45) is part of the month's one report now
// (docs/feature-audit.md, cluster 2): links from older emails and bookmarks land on the same
// month there.

const MONTH = /^\d{4}-\d{2}$/;

async function ToMonthly({
  searchParams,
}: {
  searchParams: PageProps<"/check-in">["searchParams"];
}) {
  const { m } = await searchParams;
  redirect(typeof m === "string" && MONTH.test(m) ? `/monthly?m=${m}` : "/monthly");
  return null;
}

export default function CheckInPage({ searchParams }: PageProps<"/check-in">) {
  return (
    <Suspense fallback={null}>
      <ToMonthly searchParams={searchParams} />
    </Suspense>
  );
}
