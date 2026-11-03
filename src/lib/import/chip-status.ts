import type { ImportRunView } from "@/lib/import/background";

// What /api/import/status said for the chip. "unknown" is a busy server or a dropped connection:
// the upload is still going, so it mustn't read as "nothing running", which blanks the chip and
// stops its polling for good (e2e waited 2 minutes for a Done that never showed).
export async function askImportStatus(
  fetcher: typeof fetch = fetch,
): Promise<ImportRunView | null | "unknown"> {
  try {
    const response = await fetcher("/api/import/status", { cache: "no-store" });
    if (response.status === 429 || response.status >= 500) return "unknown";
    if (!response.ok) return null;
    return ((await response.json()) as { run: ImportRunView | null }).run;
  } catch {
    return "unknown";
  }
}
