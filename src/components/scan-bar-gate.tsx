import { connection } from "next/server";
import { ScanBar } from "@/components/scan-bar";
import { scanInProgress, scanProgress } from "@/lib/scan";

// The loading bar only while a first scan runs (the sample person's, or a bank just linked);
// every other page view costs one small read and draws nothing.
export async function ScanBarGate({ userId }: { userId: string }) {
  await connection();
  if (!(await scanInProgress(userId))) return null;
  return <ScanBar initial={await scanProgress(userId)} />;
}
