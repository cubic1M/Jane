import { ScanBar } from "@/components/scan-bar";
import { scanInProgress, scanProgress } from "@/lib/scan";

// The loading bar only while a first scan runs (the sample person's, or a bank just linked);
// every other page view costs one small read and draws nothing.
// No connection() here: the header that draws it has already read the session cookie, so the
// page is dynamic, and by then requireUser has registered its after() (noting the device), after
// which Next.js rejects connection() ("used connection() inside after()"), as it did on /home.
export async function ScanBarGate({ userId }: { userId: string }) {
  if (!(await scanInProgress(userId))) return null;
  return <ScanBar initial={await scanProgress(userId)} />;
}
