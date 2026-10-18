"use server";

import { revalidatePath } from "next/cache";
import { logAudit } from "@/lib/audit";
import { retryJob } from "@/lib/jobs";
import { requireAdmin } from "@/lib/session";

export async function retry(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  const id = String(formData.get("jobId") ?? "");
  if (await retryJob(id)) {
    await logAudit({ type: "admin", id: admin.id }, "job_retried", { type: "job", id }, {});
  }
  revalidatePath("/admin/jobs");
}
