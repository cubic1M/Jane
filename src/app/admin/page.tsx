import { redirect } from "next/navigation";
import { Suspense } from "react";
import { requireAdmin } from "@/lib/session";

async function Gate(): Promise<null> {
  await requireAdmin();
  redirect("/admin/queue");
}

export default function AdminPage() {
  return (
    <Suspense>
      <Gate />
    </Suspense>
  );
}
