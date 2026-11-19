// SaveOnPhone (batch-2 keyless sources, 11-19; saveonphone.com/developers and its OpenAPI, "SaveOnPhone
// Public API 1.1.0", read 2026-11-19): a public catalog of phone-plan prices. "Free access. No account or
// API key required." "Public access is rate limited", so it's read on an admin's press, a page at a
// time. Its terms (saveonphone.com/terms, updated 2026-08-23) say nothing against an app reading it; its
// developer page asks to "cite the returned SaveOnPhone and carrier URLs, retain source dates and
// disclose affiliate links". Jane keeps the SaveOnPhone page as the source and the carrier's own page as
// the sign-up link, never SaveOnPhone's affiliate link (no paid referrals).
export const SAVEONPHONE = {
  searchUrl: "https://saveonphone.com/api/v1/plans/search",
  // "limit" is at most 10 (SearchCriteria).
  pageSize: 10,
  maxPages: 5,
  // Plans at or under this a month are read: what Jane's phone-bill finding compares against.
  maxMonthlyCents: 6_000,
  // Only plans SaveOnPhone itself verified.
  verifiedOnly: true,
} as const;
