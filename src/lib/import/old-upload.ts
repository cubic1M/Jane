import { OLD_UPLOAD_DAYS } from "@/config/import";

// The newest day previewed files reach (YYYY-MM-DD), when that's more than OLD_UPLOAD_DAYS before
// today: the files are old, and /import says so before they're imported. Null otherwise. Pure.
export function oldUploadNewest(
  files: readonly { to?: string | null }[],
  today: string,
): string | null {
  const days = files.flatMap((f) => (f.to ? [f.to.slice(0, 10)] : []));
  if (days.length === 0) return null;
  const newest = days.reduce((a, b) => (b > a ? b : a));
  const age = (Date.parse(`${today}T00:00:00Z`) - Date.parse(`${newest}T00:00:00Z`)) / 86_400_000;
  return age > OLD_UPLOAD_DAYS ? newest : null;
}
