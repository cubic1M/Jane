import { redirect } from "next/navigation";
import { Suspense } from "react";
import { requireAdmin } from "@/lib/session";

async function Gate(): Promise<null> {
  await requireAdmin();
  redirect("/admin/queue");
}

// Never kept in the browser's memory (src/lib/page-cache.ts). Every admin view goes on the access log, which a page kept in memory wouldn't reach.
export const unstable_dynamicStaleTime = 0;

export default function AdminPage() {
  return (
    <Suspense>
      <Gate />
    </Suspense>
  );
}
