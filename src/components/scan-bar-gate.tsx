import { ScanBarLazy } from "@/components/scan-bar-lazy";
import { scanInProgress, scanProgress } from "@/lib/scan";

// The loading bar only while a first scan runs (the sample person's, or a bank just linked);
// every other page view costs one small read and draws nothing.
// No connection() here: the header that draws it has already read the session cookie, so the
// page is dynamic, and by then requireUser has registered its after() (noting the device), after
// which Next.js rejects connection() ("used connection() inside after()"), as it did on /home.
//
// wasRunning: the page read its data while the scan was still going. This read comes after that
// one, so the scan can have ended in between; with no bar then, nothing would read the page
// again and it would stay as it was mid-scan ("nothing right now" on /jane beside a dock full of
// cards, CI 11-25). The bar is drawn finished, and reloads the page's data once.
export async function ScanBarGate({
  userId,
  wasRunning = false,
}: {
  userId: string;
  wasRunning?: boolean;
}) {
  if (!wasRunning && !(await scanInProgress(userId))) return null;
  return <ScanBarLazy initial={await scanProgress(userId)} />;
}
