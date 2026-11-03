import { ControlWarnings } from "@/components/control-warnings";
import { scopedFor } from "@/lib/db-scoped";

// A statement tried from the landing page that doesn't add up says so under the banner, on every
// page that has the top of the app: the upload there lands on /report without passing /import, where
// these lines are otherwise read. Rendered as part of the page's own loading, with no boundary of
// its own, so no figure can show before it. Loaded only for a temporary try, from src/lib/import/remove.ts:
// the uploads /import lists, so one removed there goes from here too.
export async function TryWarnings({ userId }: { userId: string }) {
  const { listUploads } = await import("@/lib/import/remove");
  const { uploads } = await listUploads(scopedFor(userId));
  const warnings = [...new Set(uploads.flatMap((upload) => upload.warnings))];
  if (warnings.length === 0) return null;
  return (
    <div
      role="alert"
      data-try-warnings=""
      className="flex w-full flex-col gap-1 rounded-lg border-2 border-neutral-800 px-3 py-2 dark:border-neutral-200"
    >
      <ControlWarnings warnings={warnings} />
    </div>
  );
}
