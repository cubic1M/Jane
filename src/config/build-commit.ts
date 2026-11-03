// Which commit this build is, for /api/health. green-deploy.sh ships from `git archive`, which fills
// in the placeholder below (export-subst in .gitattributes), so that path needs no setting. A build
// from a checkout leaves the placeholder, and falls back to Vercel's variable or null.
const ARCHIVED = "$Format:%H$";

export function buildCommit(): string | null {
  if (/^[0-9a-f]{40}$/.test(ARCHIVED)) return ARCHIVED;
  return process.env.BUILD_COMMIT || process.env.VERCEL_GIT_COMMIT_SHA || null;
}
