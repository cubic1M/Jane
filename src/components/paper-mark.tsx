import { PaperUser } from "@/components/trade-popup-gate";
import { adviceMode } from "@/lib/advice-mode";

// The app header's word to the trade pop-up (src/components/trade-popup-gate.tsx): this person is
// in demo advice mode. Worked out once per render (React's cache), and never holds the header up.
export async function PaperMark({ userId }: { userId: string }) {
  const advice = await adviceMode(userId).catch(() => false);
  return advice ? <PaperUser userId={userId} /> : null;
}
